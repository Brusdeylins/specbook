/*
**  Specification Book (SpecBook)
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

/*  tests of the schema configuration: the bundled standard schema and
    the expansion and validation of the mixins  */

import { test }          from "node:test"
import assert            from "node:assert/strict"
import fs                from "node:fs"
import os                from "node:os"
import path              from "node:path"

import { standardConfig } from "../dst/specbook-api.js"
import { loadConfig }     from "../dst/specbook-config.js"

/*  write configuration files into a fresh temporary directory  */
const configFiles = (...contents) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specbook-test-"))
    return contents.map((content, i) => {
        const file = path.join(dir, `config-${i}.yaml`)
        fs.writeFileSync(file, content, "utf8")
        return file
    })
}

/*  find an object kind by its path of kind names (artifacts by their id)  */
const kindOf = (config, artifact, ...kinds) => {
    let object = config.find((o) => o.id === artifact)
    for (const kind of kinds)
        object = object?.children?.find((o) => o.kind === kind)
    return object
}
const propNames = (object) => (object?.props ?? []).map((p) => p.name)
const errors    = (diagnostics) => diagnostics.filter((d) => d.severity === "error")

test("standard schema loads without diagnostics", () => {
    const { config, diagnostics } = loadConfig([ standardConfig ])
    assert.deepEqual(diagnostics, [])
    assert.ok(config !== undefined)
})

test("standard schema places the new artifacts in document order", () => {
    const { config } = loadConfig([ standardConfig ])
    const ids = config.map((o) => o.id)
    const at  = (id) => ids.indexOf(id)
    assert.ok(at("CO") < at("NC") && at("NC") < at("PV") && at("PV") < at("DV"))
    assert.ok(at("CP") < at("CM") && at("CM") < at("TC"))
    assert.equal(kindOf(config, "NC").file, "35-ARCH-NC-Named-Constants.md")
    assert.equal(kindOf(config, "PV").file, "36-ARCH-PV-Processing-View.md")
    assert.equal(kindOf(config, "CM").file, "37-ARCH-CM-Code-Map.md")
    assert.equal(kindOf(config, "TC").file, "34-TEST-TC-Test-Cases.md")
})

test("standard schema expands the EVIDENCE mixin and drops the mixins", () => {
    const { config } = loadConfig([ standardConfig ])
    assert.ok(config.every((o) => o.mixin === undefined))
    for (const [ artifact, ...kinds ] of [
        [ "NC", "CONSTANT" ], [ "PV", "STRUCTURE" ], [ "PV", "ALGORITHM" ],
        [ "PV", "PIPELINE" ], [ "PV", "PIPELINE", "STAGE" ], [ "CM", "SYMBOL" ],
        [ "IM", "INTERFACE" ], [ "ID", "TYPE" ], [ "IE", "ENDPOINT" ],
        [ "FV", "COMPONENT" ], [ "CO", "UNIT" ], [ "DD", "DECISION" ] ]) {
        const object = kindOf(config, artifact, ...kinds)
        assert.ok(propNames(object).includes("EVIDENCE"), `${kinds.join(".")} lacks EVIDENCE`)
        assert.ok(propNames(object).includes("SOURCE"),   `${kinds.join(".")} lacks SOURCE`)
        assert.equal(object.mixins, undefined)
    }

    /*  the prescriptive kinds deliberately carry no evidence  */
    assert.ok(!propNames(kindOf(config, "FR", "REQUIREMENT")).includes("EVIDENCE"))
    assert.ok(!propNames(kindOf(config, "NR", "REQUIREMENT")).includes("EVIDENCE"))
})

test("mixin is included by a later configuration file", () => {
    const [ overlay ] = configFiles(`
-   kind: DATA
    id: DM
    children:
        -   kind: ENTITY
            mixins:
                -   EVIDENCE
`)
    const { config, diagnostics } = loadConfig([ standardConfig, overlay ])
    assert.deepEqual(errors(diagnostics), [])
    const names = propNames(kindOf(config, "DM", "ENTITY"))
    assert.ok(names.includes("EVIDENCE") && names.includes("SOURCE"))
})

test("own property refines the property of a mixin", () => {
    const [ file ] = configFiles(`
-   mixin: TRACE
    props:
        -   name: ORIGIN
            desc: generic
            optional: true
        -   name: OWNER
            optional: true
-   kind: SPEC
    name: Things
    file: things.md
    mixins:
        -   TRACE
    props:
        -   name: ORIGIN
            desc: refined
`)
    const { config, diagnostics } = loadConfig([ file ])
    assert.deepEqual(diagnostics, [])
    const props = config[0].props
    assert.deepEqual(props.map((p) => p.name), [ "ORIGIN", "OWNER" ])
    assert.equal(props[0].desc, "refined")
    assert.equal(props[0].optional, undefined)
})

test("unknown mixin is reported", () => {
    const [ file ] = configFiles(`
-   kind: SPEC
    name: Things
    file: things.md
    mixins:
        -   NOPE
`)
    const { config, diagnostics } = loadConfig([ file ])
    assert.equal(config, undefined)
    assert.equal(errors(diagnostics).length, 1)
    assert.match(diagnostics[0].message, /unknown mixin "NOPE"/)
    assert.equal(diagnostics[0].line, 6)
})

test("duplicate mixin and invalid mixin property are reported", () => {
    const [ file ] = configFiles(`
-   mixin: TRACE
    props:
        -   name: ORIGIN
            value: enum(
-   mixin: TRACE
    props:
        -   name: OTHER
-   kind: SPEC
    name: Things
    file: things.md
`)
    const { diagnostics } = loadConfig([ file ])
    const messages = errors(diagnostics).map((d) => d.message)
    assert.ok(messages.some((m) => /invalid value expression "enum\("/.test(m)), messages.join("\n"))
    assert.ok(messages.some((m) => /"mixin:TRACE" collides/.test(m)), messages.join("\n"))
})

test("mixin without properties is rejected structurally", () => {
    const [ file ] = configFiles(`
-   mixin: EMPTY
    props: []
-   kind: SPEC
    name: Things
    file: things.md
`)
    const { config, diagnostics } = loadConfig([ file ])
    assert.equal(config, undefined)
    assert.match(diagnostics[0].message, /invalid configuration: 0\.props/)
})

test("diagram lists validate, merge by type, and check the layout cells", () => {
    const [ base, overlay, broken ] = configFiles(`
-   kind: SPEC
    name: Things
    file: things.md
    diagram:
        -   type: grid
        -   type: layout
            cells:
                offset: OFFSET
                size: SIZE
`, `
-   kind: SPEC
    name: Things
    diagram:
        -   type: layout
            cells:
                offset: OFFSET
                size: SIZE
                value: VALUE
`, `
-   kind: SPEC
    name: Things
    file: things.md
    diagram:
        type: layout
        cells:
            offset: OFFSET
`)
    const { config, diagnostics } = loadConfig([ base, overlay ])
    assert.deepEqual(diagnostics, [])
    assert.equal(config[0].diagram.length, 2)
    assert.deepEqual(config[0].diagram[1].cells, { offset: "OFFSET", size: "SIZE", value: "VALUE" })
    const result = loadConfig([ broken ])
    assert.equal(result.config, undefined)
    assert.match(result.diagnostics[0].message, /cells/)
})
