/*
**  Specification Book (SpecBook)
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

import * as fs                                               from "node:fs"
import { parseDocument, isNode, LineCounter, type Document } from "yaml"
import * as v                                                from "valibot"
import { mergeWith, isPlainObject }                          from "es-toolkit"

import { SchemaConfig, isSchemaMixin, diagramsOf, type Schema, type SchemaObject, type SchemaMixin,
    type SchemaProperty, type SchemaDiagram, type SchemaDiagramType }  from "./specbook-format-schema.js"
import { compileValueExpr, anchored, admitsReferences, type ValueExpr } from "./specbook-parse-value.js"
import { type Diagnostic }                                              from "./specbook-diagnostic.js"

/*  a path into the YAML document (object keys and sequence indexes)  */
type YamlPath = (string | number)[]

/*  determine line/column of a YAML document path via the node ranges
    of the parsed document, falling back to the closest ancestor node  */
export const lineColOfPath = (doc: Document, lines: LineCounter, path: YamlPath) => {
    for (let i = path.length; i >= 0; i--) {
        const node  = doc.getIn(path.slice(0, i), true)
        const start = isNode(node) ? node.range?.[0] : undefined
        if (start !== undefined) {
            const pos = lines.linePos(start)
            return { line: pos.line, column: pos.col }
        }
    }
    return { line: 1, column: 1 }
}

/*  the identity by which the elements of the lists of the configuration
    are matched on merging: the artifacts by their kind plus id or name,
    the mixins by their name, and the nested objects by their kind alone
    (exactly like the sibling resolution), the properties by their name,
    the diagrams of a diagram list by their type, and the scalar entries
    by their value  */
const identityOf = (item: unknown, list?: string): string => {
    if (!isPlainObject(item))
        return String(item)
    const object = item as Record<string, unknown>
    if (list === "props")
        return String(object.name ?? "")
    else if (list === "diagram")
        return String(object.type ?? "graph")
    else if (list === "children")
        return String(object.kind ?? "")
    else if (isSchemaMixin(object))
        return `mixin:${String(object.mixin)}`
    else
        return `${String(object.kind ?? "")}:${String(object.id ?? object.name ?? "")}`
}

/*  merge a source configuration (or a nested part of it) into a target
    one: the objects merge deeply, while the elements of the lists are
    matched by their identity, so a matching element is merged into its
    counterpart and an unmatched one is appended  */
const mergeConfig = (target: unknown, source: unknown, list?: string): unknown => {
    /*  an empty or comment-only YAML document carries no content at
        all, so it leaves the target intact instead of discarding it  */
    if (source === null || source === undefined)
        return target
    else if (Array.isArray(target) && Array.isArray(source)) {
        const items = target as unknown[]
        for (const item of source as unknown[]) {
            const ident = identityOf(item, list)
            const i     = items.findIndex((existing) => identityOf(existing, list) === ident)
            if (i < 0)
                items.push(item)
            else
                items[i] = mergeConfig(items[i], item, list)
        }
        return items
    }
    else if (isPlainObject(target) && isPlainObject(source))
        return mergeWith(target, source, (t: unknown, s: unknown, key: string) => {
            /*  a single diagram merges into a diagram list (and a list
                into a single diagram) as the list of just that diagram,
                so it still matches its counterpart by type  */
            if (key === "diagram" && (Array.isArray(t) || Array.isArray(s)) && t !== undefined)
                return mergeConfig(Array.isArray(t) ? t : [ t ], Array.isArray(s) ? s : [ s ], key)
            return Array.isArray(t) && Array.isArray(s) ? mergeConfig(t, s, key) : undefined
        })
    else
        return source
}

/*  deep copy a converted YAML document, as the conversion resolves all
    aliases of an anchor onto one shared object, which the in-place
    merge otherwise would alter through every alias at once  */
const unshared = (value: unknown): unknown => {
    if (Array.isArray(value))
        return (value as unknown[]).map((item) => unshared(item))
    else if (isPlainObject(value))
        return Object.fromEntries(Object.entries(value).map(([ key, val ]) => [ key, unshared(val) ]))
    else
        return value
}

/*  a parsed configuration file: its document (with the line positions
    for the diagnostics) and its raw content for the path translation  */
type ConfigDoc = { file: string, doc: Document, lines: LineCounter, raw: unknown }

/*  determine file and line/column of a path into the merged
    configuration by translating the path into every document (from the
    last to the first one, as a later document overrides an earlier one),
    where a list index is translated through the identity of the merged
    element, and by taking the deepest reaching translation, whose path
    is returned, too (or the original one if it does not reach fully)  */
const posOfMergedPath = (docs: ConfigDoc[], merged: unknown, path: YamlPath) => {
    const at = (value: unknown, key: string | number): unknown =>
        (value as Record<string | number, unknown> | null | undefined)?.[key]
    let best = { file: docs[docs.length - 1].file, line: 1, column: 1, path, depth: -1 }
    for (const { file, doc, lines, raw } of docs.toReversed()) {
        const translated: YamlPath = []
        let node = merged
        let own  = raw
        let list: string | undefined
        for (const segment of path) {
            let key: string | number = segment
            if (typeof segment === "number" && Array.isArray(own)) {
                const ident = identityOf(at(node, segment), list)
                key = own.findIndex((item: unknown) => identityOf(item, list) === ident)
            }
            const reaches = typeof key === "number" ?
                Array.isArray(own) && key >= 0 :
                isPlainObject(own) && key in own
            if (!reaches)
                break
            translated.push(key)
            node = at(node, segment)
            own  = at(own, key)
            if (typeof segment === "string")
                list = segment
        }
        if (translated.length > best.depth)
            best = { file, ...lineColOfPath(doc, lines, translated), path: translated, depth: translated.length }
    }
    return { file: best.file, line: best.line, column: best.column,
        path: best.depth === path.length ? best.path : path }
}

/*  the sink of the constraint diagnostics, positioned by a path into
    the merged configuration  */
type Diagnose = (path: YamlPath, message: string) => void

/*  check the properties of an object: the value expressions have to be
    syntactically valid, the relation shape flags apply to
    reference-valued properties only, and the sibling marker flags
    optionally carry a regexp or enum expression  */
const checkProperties = (props: SchemaProperty[], at: YamlPath, diagnose: Diagnose) => {
    for (const [ j, prop ] of props.entries()) {
        /*  the sibling marker flags optionally carry a regexp or
            enum expression selecting the values they apply to  */
        for (const flag of [ "unique", "present" ] as const) {
            const marker = prop[flag]
            if (typeof marker !== "string")
                continue
            let kind: ValueExpr["kind"] | undefined
            try {
                kind = compileValueExpr(marker).kind
            }
            catch (err) {
                diagnose([ ...at, "props", j, flag ],
                    `invalid "${flag}" expression "${marker}": ` +
                        (err instanceof Error ? err.message : String(err)))
            }
            if (kind !== undefined && kind !== "regex" && kind !== "enum")
                diagnose([ ...at, "props", j, flag ],
                    `"${flag}" expression "${marker}" is neither a regexp nor an enum`)
        }

        /*  the relation shape flags apply to reference-valued
            properties only (an invalid expression is reported on
            its own, without a cascading flag diagnostic)  */
        let expr: ValueExpr | undefined
        if (prop.value !== undefined) {
            try {
                expr = compileValueExpr(prop.value)
            }
            catch (err) {
                diagnose([ ...at, "props", j, "value" ],
                    `invalid value expression "${prop.value}": ` +
                        (err instanceof Error ? err.message : String(err)))
                continue
            }
        }
        for (const flag of [ "local", "symmetric", "acyclic" ] as const)
            if (prop[flag] === true && (expr === undefined || !admitsReferences(expr)))
                diagnose([ ...at, "props", j, flag ],
                    `"${flag}" flag requires a reference-valued property`)
    }
}

/*  the properties of an object kind: its own ones, followed by those of
    its mixins (in their order) which it does not declare itself, as an
    own declaration replaces the one of a mixin as a whole  */
const propsOf = (object: SchemaObject, mixins: Map<string, SchemaMixin>): SchemaProperty[] => {
    const props = [ ...(object.props ?? []) ]
    for (const name of object.mixins ?? [])
        for (const prop of mixins.get(name)?.props ?? [])
            if (!props.some((p) => p.name === prop.name))
                props.push(prop)
    return props
}

/*  check the automaton of an object (if any): it names the child kinds
    acting as nodes and edges, the reference-valued edge properties
    referencing the source and target nodes, and the node properties
    flagging the initial and final nodes  */
const checkAutomaton = (object: SchemaObject, mixins: Map<string, SchemaMixin>, at: YamlPath, diagnose: Diagnose) => {
    if (object.automaton === undefined)
        return
    const automaton = object.automaton
    const childOf   = (kind: string) => (object.children ?? []).find((c) => c.kind === kind)
    const propOf    = (child: SchemaObject | undefined, name: string) =>
        (child !== undefined ? propsOf(child, mixins) : []).find((p) => p.name === name)
    /*  an invalid value expression is reported on its own (see
        "checkProperties"), so it must not cascade into a shape diagnostic  */
    const isReference = (prop: SchemaProperty): boolean | undefined => {
        try {
            return prop.value !== undefined && admitsReferences(compileValueExpr(prop.value))
        }
        catch {
            return undefined
        }
    }
    const nodes = childOf(automaton.nodes)
    const edges = childOf(automaton.edges)
    for (const [ field, child ] of [ [ "nodes", nodes ], [ "edges", edges ] ] as const)
        if (child === undefined)
            diagnose([ ...at, "automaton", field ],
                `"automaton" ${field} kind "${automaton[field]}" is not a child object kind`)
    for (const field of [ "source", "target" ] as const) {
        const prop = propOf(edges, automaton[field])
        if (edges !== undefined && prop === undefined)
            diagnose([ ...at, "automaton", field ],
                `"automaton" ${field} property "${automaton[field]}" is not a property of "${automaton.edges}"`)
        else if (prop !== undefined && isReference(prop) === false)
            diagnose([ ...at, "automaton", field ],
                `"automaton" ${field} property "${automaton[field]}" is not reference-valued`)
    }
    for (const field of [ "initial", "final" ] as const)
        if (nodes !== undefined && propOf(nodes, automaton[field]) === undefined)
            diagnose([ ...at, "automaton", field ],
                `"automaton" ${field} property "${automaton[field]}" is not a property of "${automaton.nodes}"`)
}

/*  the diagram options restricted to some diagram types (an option
    set to "false" counts as absent), the options a diagram type
    requires, and the edge-less diagram types  */
const diagramOptionTypes: Partial<Record<keyof SchemaDiagram, SchemaDiagramType[]>> = {
    center:        [ "hub" ],
    centerEdges:   [ "hub" ],
    nest:          [ "graph", "grid" ],
    cells:         [ "layout" ],
    layers:        [ "layer" ],
    columns:       [ "matrix" ],
    lifelines:     [ "sequence" ],
    edges:         [ "graph", "hub", "layer", "matrix", "sequence" ],
    hierarchy:     [ "graph", "hub", "layer", "matrix", "sequence" ],
    deep:          [ "graph", "hub", "layer", "matrix", "sequence" ],
    labeled:       [ "graph", "hub", "layer", "matrix", "sequence" ],
    onlyConnected: [ "graph", "matrix" ]
}
const diagramRequired: Partial<Record<SchemaDiagramType, (keyof SchemaDiagram)[]>> = {
    layout: [ "cells" ],
    layer:  [ "layers" ]
}

/*  check the diagrams of an object kind: the types of a diagram list
    have to be distinct (as a list merges by type), every option has to
    suit the diagram type, a traceability matrix cannot drop its
    unconnected rows and columns (as they are its gaps), the "/xxx/"
    shape values have to be valid patterns, and the property names of
    the newer options have to name a property of the schema (as a typo
    would otherwise silently empty the diagram)  */
const checkDiagrams = (object: SchemaObject, propNames: Set<string>, at: YamlPath, diagnose: Diagnose) => {
    const list  = Array.isArray(object.diagram)
    const types = new Set<string>()
    for (const [ d, diagram ] of diagramsOf(object).entries()) {
        const where = list ? [ ...at, "diagram", d ] : [ ...at, "diagram" ]
        const type  = diagram.type ?? "graph"
        if (types.has(type))
            diagnose([ ...where, "type" ], `diagram type "${type}" occurs more than once in the diagram list`)
        types.add(type)
        for (const [ option, allowed ] of Object.entries(diagramOptionTypes)) {
            const value = diagram[option as keyof SchemaDiagram]
            if (value !== undefined && value !== false && !allowed.includes(type))
                diagnose([ ...where, option ], `"${type}" diagram cannot carry ` +
                    `${(/^[aeiou]/).test(option) ? "an" : "a"} "${option}" configuration`)
        }
        for (const option of diagramRequired[type] ?? [])
            if (diagram[option] === undefined)
                diagnose(where, `"${type}" diagram requires a "${option}" configuration`)
        if (diagram.columns !== undefined && diagram.onlyConnected === true)
            diagnose([ ...where, "onlyConnected" ],
                "traceability matrix (with \"columns\") cannot carry \"onlyConnected\", as it would drop its gaps")
        for (const [ r, rule ] of (diagram.shapes ?? []).entries()) {
            const m = /^\/(.*)\/$/.exec(rule.value)
            if (m === null)
                continue
            try {
                anchored(m[1])
            }
            catch (err) {
                diagnose([ ...where, "shapes", r, "value" ], `invalid shape pattern "${rule.value}": ` +
                    (err instanceof Error ? err.message : String(err)))
            }
        }
        const names: [ YamlPath, string | undefined ][] = [
            [ [ "cells", "offset" ], diagram.cells?.offset ],
            [ [ "cells", "size" ], diagram.cells?.size ],
            [ [ "cells", "value" ], diagram.cells?.value ],
            [ [ "lifelines" ], diagram.lifelines ],
            [ [ "edgeLabels", "source" ], diagram.edgeLabels?.source ],
            [ [ "edgeLabels", "target" ], diagram.edgeLabels?.target ],
            ...(diagram.layers?.via ?? []).map((name, i): [ YamlPath, string ] => [ [ "layers", "via", i ], name ]),
            ...(diagram.linkProps ?? []).map((name, i): [ YamlPath, string ] => [ [ "linkProps", i ], name ]),
            ...(diagram.shapes ?? []).map((rule, i): [ YamlPath, string ] => [ [ "shapes", i, "property" ], rule.property ]),
            ...(diagram.edgeLabels?.properties ?? []).map((name, i): [ YamlPath, string ] =>
                [ [ "edgeLabels", "properties", i ], name ])
        ]
        for (const [ path, name ] of names)
            if (name !== undefined && !propNames.has(name))
                diagnose([ ...where, ...path ], `diagram property "${name}" is not a property of any object kind`)
    }
}

/*  check the constraints of a structurally valid configuration which
    are beyond its schema: sibling objects have to stay distinctly
    resolvable, "file" fields are allowed on the first (artifact) level
    only and have to be relative paths below the base directory,
    property value and marker expressions have to be syntactically
    valid, the mixins included by an object have to exist, "referenced"
    and "coverage" entries have to be reference expressions, an
    "automaton" has to name existing child kinds and properties, and the
    names of non-artifact objects have to be valid patterns (as they are
    compiled into regular expressions)  */
const checkConstraints = (
    config:    SchemaConfig,
    mixins:    Map<string, SchemaMixin>,
    posOfPath: (path: YamlPath) => { file: string, line: number, column: number }
): Diagnostic[] => {
    const diagnostics = new Array<Diagnostic>()
    const diagnose = (path: YamlPath, message: string) => {
        const { file, line, column } = posOfPath(path)
        diagnostics.push({ file, line, column, severity: "error", message })
    }

    /*  the names of all properties of the schema, against which the
        property names of the diagram configurations are checked  */
    const propNames = new Set<string>()
    const collect = (entries: SchemaConfig) => {
        for (const entry of entries) {
            for (const prop of entry.props ?? [])
                propNames.add(prop.name)
            if (!isSchemaMixin(entry) && entry.children !== undefined)
                collect(entry.children)
        }
    }
    collect(config)
    const check = (entries: SchemaConfig, path: YamlPath, depth: number) => {
        /*  the sibling objects are resolved by kind and id on the first
            (artifact) level and by kind alone below it, so a sibling
            colliding on this key stays unreachable dead configuration
            (and so does a mixin colliding with a preceding one)  */
        const seen = new Set<string>()
        for (const [ i, entry ] of entries.entries()) {
            const at    = [ ...path, i ]
            const ident = identityOf(entry, depth > 1 ? "children" : undefined)
            if (seen.has(ident))
                diagnose([ ...at, isSchemaMixin(entry) ? "mixin" : "kind" ],
                    `object "${ident}" collides with a preceding sibling object (the later one is unreachable)`)
            else
                seen.add(ident)

            /*  a mixin carries nothing but its properties  */
            if (isSchemaMixin(entry)) {
                checkProperties(entry.props, at, diagnose)
                continue
            }
            const object = entry
            for (const [ j, name ] of (object.mixins ?? []).entries())
                if (!mixins.has(name))
                    diagnose([ ...at, "mixins", j ], `unknown mixin "${name}"`)
            if (depth > 1 && object.file !== undefined)
                diagnose([ ...at, "file" ],
                    `"file" field is only allowed on the first (artifact) level (found on level ${depth})`)

            /*  an artifact file is placed below the base directory, so
                it must neither be absolute nor escape that directory  */
            if (depth === 1 && object.file !== undefined
                && ((/^(?:[/\\]|[A-Za-z]:)/).test(object.file) || (/(?:^|[/\\])\.\.(?:[/\\]|$)/).test(object.file)))
                diagnose([ ...at, "file" ],
                    `"file" field "${object.file}" is not a relative path below the base directory`)
            checkProperties(object.props ?? [], at, diagnose)
            checkAutomaton(object, mixins, at, diagnose)
            checkDiagrams(object, propNames, at, diagnose)
            for (const field of [ "referenced", "coverage" ] as const)
                for (const [ j, entry ] of (object[field] ?? []).entries()) {
                    /*  a reference coverage entry has to be a single
                        (usually wildcard) reference expression  */
                    let expr: ValueExpr | undefined
                    try {
                        expr = compileValueExpr(entry)
                    }
                    catch (err) {
                        diagnose([ ...at, field, j ],
                            `invalid "${field}" entry "${entry}": ` +
                                (err instanceof Error ? err.message : String(err)))
                    }
                    if (expr !== undefined && expr.kind !== "reference")
                        diagnose([ ...at, field, j ],
                            `"${field}" entry "${entry}" is not a single "[[xxx]]" reference`)
                }
            if (depth > 1 && object.name !== undefined) {
                try {
                    anchored(object.name)
                }
                catch (err) {
                    diagnose([ ...at, "name" ],
                        `invalid name pattern "${object.name}": ` +
                            (err instanceof Error ? err.message : String(err)))
                }
            }
            if (object.children !== undefined)
                check(object.children, [ ...at, "children" ], depth + 1)
        }
    }
    check(config, [], 1)
    return diagnostics
}

/*  the statistics of a schema configuration: the number of specified
    object kinds (recursively) and of relationship kinds, i.e. the
    reference-valued properties (whose expressions are valid, as the
    configuration is validated before use)  */
export const configStatistics = (config: Schema): { objects: number, links: number } => {
    let objects = 0
    let links   = 0
    const walk = (object: SchemaObject) => {
        objects++
        for (const prop of object.props ?? [])
            if (prop.value !== undefined && admitsReferences(compileValueExpr(prop.value)))
                links++
        for (const child of object.children ?? [])
            walk(child)
    }
    for (const object of config)
        walk(object)
    return { objects, links }
}

/*  load and validate the YAML schema configuration, merged in order out
    of its files (the later ones into the earlier ones), where every file
    has to be readable and syntactically valid on its own, while the
    merged result alone is validated  */
export const loadConfig = (files: string[]): { config?: Schema, diagnostics: Diagnostic[] } => {
    if (files.length === 0)
        throw new Error("no configuration files given")
    const diagnostics = new Array<Diagnostic>()

    /*  read and syntactically parse every configuration file into its
        document, keeping the line positions for the diagnostics  */
    const docs = new Array<ConfigDoc>()
    for (const file of files) {
        let yaml: string
        try {
            yaml = fs.readFileSync(file, "utf8")
        }
        catch (err) {
            diagnostics.push({ file, line: 1, column: 1, severity: "error",
                message: "cannot read configuration file: " +
                    (err instanceof Error ? err.message : String(err)) })
            continue
        }
        const lines = new LineCounter()
        const doc   = parseDocument(yaml, { lineCounter: lines })

        /*  strip the position and the source snippet the YAML parser
            appends to its message, as the diagnostic carries the
            position itself  */
        for (const err of doc.errors)
            diagnostics.push({
                file,
                line:     err.linePos?.[0].line ?? 1,
                column:   err.linePos?.[0].col  ?? 1,
                severity: "error",
                message:  "invalid YAML syntax: " + err.message.replace(/ at line \d+, column \d+(?::\n[\s\S]*)?$/, "")
            })
        if (doc.errors.length === 0)
            docs.push({ file, doc, lines, raw: doc.toJS() })
    }
    if (diagnostics.length > 0)
        return { diagnostics }

    /*  merge the documents in order, out of unshared deep copies of
        the conversions, as the merge mutates its target while the raw
        ones have to stay intact for the path translation  */
    const merged = docs.map(({ raw }) => unshared(raw))
        .reduce((target, source) => mergeConfig(target, source))

    /*  semantically validate the merged result against the schema of the configuration  */
    const posOfPath = (path: YamlPath) => posOfMergedPath(docs, merged, path)
    const result    = v.safeParse(SchemaConfig, merged)
    if (!result.success) {
        for (const issue of result.issues) {
            /*  the path is rendered as it is in the positioned file  */
            const { file, line, column, path } =
                posOfPath((issue.path ?? []).map((item) => item.key as string | number))
            const where = path.length > 0 ? `${path.join(".")}: ` : ""
            diagnostics.push({ file, line, column, severity: "error",
                message: `invalid configuration: ${where}${issue.message}` })
        }
        return { diagnostics }
    }

    /*  check the constraints beyond the structural schema  */
    const mixins = new Map(result.output.filter((entry) => isSchemaMixin(entry))
        .map((entry) => [ entry.mixin, entry ]))
    diagnostics.push(...checkConstraints(result.output, mixins, posOfPath))
    if (diagnostics.length > 0)
        return { diagnostics }

    /*  expand the mixins into the properties of the object kinds
        including them and drop the mixins themselves, so every consumer
        sees plain object kinds  */
    const expand = (object: SchemaObject): SchemaObject => {
        const { mixins: names, ...rest } = object
        return {
            ...rest,
            ...(names !== undefined           ? { props: propsOf(object, mixins) }         : {}),
            ...(object.children !== undefined ? { children: object.children.map(expand) } : {})
        }
    }
    const config = result.output.filter((entry): entry is SchemaObject => !isSchemaMixin(entry))
        .map((entry) => expand(entry))
    return { config, diagnostics }
}
