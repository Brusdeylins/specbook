/*
**  Specification Book (SpecBook)
**  Copyright (c) 2026 Dr. Ralf S. Engelschall <rse@engelschall.com>
**  Licensed under Apache 2.0 <https://spdx.org/licenses/Apache-2.0>
*/

/*  tests of linting and exporting a specification using the Named
    Constants, Processing View, and Code Map artifacts of the standard
    schema, against the fixture below "tst/fixture" and the sample
    specification below "smp/broadcast"  */

import { test }      from "node:test"
import assert        from "node:assert/strict"
import fs            from "node:fs"
import os            from "node:os"
import path          from "node:path"

import { SpecBook }  from "../dst/specbook-api.js"

const root     = path.resolve(import.meta.dirname, "..")
const fixture  = path.join(root, "tst", "fixture")
const errors   = (result) => result.diagnostics.filter((d) => d.severity === "error")
const warnings = (result) => result.diagnostics.filter((d) => d.severity === "warning")

/*  copy the fixture into a fresh temporary directory, applying a
    textual replacement onto one of its files  */
const variant = (file, from, to) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "specbook-test-"))
    fs.cpSync(fixture, dir, { recursive: true })
    const target  = path.join(dir, file)
    const content = fs.readFileSync(target, "utf8")
    assert.ok(content.includes(from), `fixture "${file}" lacks "${from}"`)
    fs.writeFileSync(target, content.replace(from, to), "utf8")
    return dir
}

/*  find an object of a parsed or exported specification by kind and name  */
const objectOf = (spec, kind, name) => {
    let found
    const walk = (object) => {
        if (object.kind === kind && object.name === name)
            found = object
        for (const child of object.children ?? [])
            walk(child)
    }
    for (const artifact of spec.artifacts)
        for (const object of artifact.objects)
            walk(object)
    return found
}

test("fixture lints cleanly", async () => {
    const result = await new SpecBook().lint({ config: [ "std" ], basedir: fixture })
    assert.deepEqual(result.diagnostics, [])
    const symbol = objectOf(result.specification, "SYMBOL", "checksum_simd")
    assert.equal(symbol.properties.find((p) => p.key === "EVIDENCE").value, "Inferred")
})

test("sample specification lints without errors", async () => {
    const result = await new SpecBook().lint({ config: [ "std" ], basedir: path.join(root, "smp", "broadcast") })
    assert.deepEqual(errors(result), [])
    assert.deepEqual(warnings(result), [])
})

test("invalid constant class is an error", async () => {
    const basedir = variant("29-ARCH-NC-Named-Constants.md", "CLASS: Size", "CLASS: Bogus")
    const result  = await new SpecBook().lint({ config: [ "std" ], basedir })
    assert.equal(errors(result).length, 1)
    assert.match(errors(result)[0].message, /CLASS/)
})

test("invalid evidence of a mixin property is an error", async () => {
    const basedir = variant("36-ARCH-CM-Code-Map.md", "EVIDENCE:   Inferred", "EVIDENCE:   Guessed")
    const result  = await new SpecBook().lint({ config: [ "std" ], basedir })
    assert.equal(errors(result).length, 1)
    assert.match(errors(result)[0].message, /EVIDENCE/)
})

test("unreferenced constant is a warning", async () => {
    const basedir = variant("30-ARCH-PV-Processing-View.md", "-   BUDGET: [[CONSTANT:batch-budget]]\n", "")
    const result  = await new SpecBook().lint({ config: [ "std" ], basedir })
    assert.deepEqual(errors(result), [])
    assert.equal(warnings(result).length, 1)
    assert.match(warnings(result)[0].message, /BATCH_BUDGET/)
})

test("stage fed by a stage of another pipeline is an error", async () => {
    const basedir = variant("30-ARCH-PV-Processing-View.md",
        "The stage verifies the checksum, BECAUSE corrupt records must not enter the queue.\n",
        "The stage verifies the checksum, BECAUSE corrupt records must not enter the queue.\n\n" +
        "##  PIPELINE: Other Path {{other-path}}\n\n" +
        "The other path, BECAUSE it is needed.\n\n" +
        "### STAGE: Foreign Stage {{foreign}}\n\n" +
        "-   FED-BY: [[STAGE:verify]]\n\n" +
        "The foreign stage, BECAUSE it is needed.\n")
    const result = await new SpecBook().lint({ config: [ "std" ], basedir })
    assert.equal(errors(result).length, 1)
    assert.match(errors(result)[0].message, /FED-BY/)
})

test("export derives the diagrams and the coverage of the new artifacts", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "json" ] })
    const spec = JSON.parse(json.toString("utf8"))
    for (const [ kind, name ] of [
        [ "ARCH", "Named Constants" ], [ "ARCH", "Processing View" ],
        [ "PIPELINE", "Intake Path" ], [ "STRUCTURE", "Intake Queue" ],
        [ "ALGORITHM", "Record Checksum" ], [ "CONSTANT", "QUEUE_DEPTH" ] ])
        assert.equal(typeof objectOf(spec, kind, name)?.diagram, "string", `${kind} "${name}" lacks a diagram`)

    /*  the pipeline diagram lines up the stages in document order and
        draws the "fed-by" edge between them  */
    const pipeline = objectOf(spec, "PIPELINE", "Intake Path").diagram
    assert.match(pipeline, /Receive Record/)
    assert.match(pipeline, /Verify Record/)
    assert.match(pipeline, /fed-by/)

    /*  the code map of a single symbol collapses its diagram, but still
        reports the implemented share per pattern  */
    assert.equal(objectOf(spec, "ARCH", "Code Map").diagram, undefined)
    const coverage = objectOf(spec, "ARCH", "Code Map").coverage
    const algorithms = coverage.find((c) => c.pattern === "[[ALGORITHM:*]]")
    assert.deepEqual([ algorithms.covered, algorithms.total ], [ 1, 1 ])
})

test("HTML export renders the new artifacts with their diagrams", async () => {
    const [ html ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "html" ] })
    const text = html.toString("utf8")
    for (const id of [ "ARCH-NC", "ARCH-PV", "ARCH-CM", "ARCH-PV.PIPELINE-intake-path" ])
        assert.ok(text.includes(`id=${id}`) || text.includes(`id="${id}"`), `HTML lacks anchor "${id}"`)
    assert.ok((text.match(/data-type=graph|data-type="graph"/g) ?? []).length >= 2)
    assert.ok((text.match(/data-type=hub|data-type="hub"/g) ?? []).length >= 3)
})

test("a binary format type derives a hub and a layout diagram", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "json" ] })
    const spec = JSON.parse(json.toString("utf8"))
    const diagrams = objectOf(spec, "TYPE", "RecordFrame").diagram
    assert.ok(Array.isArray(diagrams) && diagrams.length === 2)
    assert.match(diagrams[0], /^#type hub/)
    assert.match(diagrams[1], /^#type layout/)

    /*  a field off the byte boundary switches to bit cells, 32 per row,
        the offsets and sizes being converted into such cells  */
    assert.match(diagrams[1], /#config layout-cell-bits 1\n/)
    assert.match(diagrams[1], /#config layout-row-cells 32\n/)
    assert.match(diagrams[1], /FIELD-magic: magic \[ [^\]]*offset: 0, size: 16, value: 0x52F1 \]/)
    assert.match(diagrams[1], /FIELD-urgent: urgent \[ [^\]]*offset: 20, size: 1 \]/)
    assert.match(diagrams[1], /FIELD-payload: payload \[ [^\]]*offset: 64, size: "\*" \]/)
})

test("a byte-aligned format uses byte cells", async () => {
    const basedir = variant("15-APIS-ID-Interface-Datatypes.md",
        "-   version; TYPE: `integer`; OFFSET: 2; SIZE: 4 bit; VALUE: `0001`;\n" +
        "    The version of the frame layout, BECAUSE the layout may evolve.\n\n" +
        "-   urgent; TYPE: `boolean`; OFFSET: 2.4; SIZE: 1 bit;\n",
        "-   version; TYPE: `integer`; OFFSET: 2; SIZE: 1;\n" +
        "    The version of the frame layout, BECAUSE the layout may evolve.\n\n" +
        "-   urgent; TYPE: `boolean`; OFFSET: 3; SIZE: 1;\n")
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir, formats: [ "json" ] })
    const layout = objectOf(JSON.parse(json.toString("utf8")), "TYPE", "RecordFrame").diagram[1]
    assert.match(layout, /#config layout-cell-bits 8\n/)
    assert.match(layout, /#config layout-row-cells 16\n/)
    assert.match(layout, /FIELD-length: length \[ [^\]]*offset: 4, size: 4 \]/)
})

test("omitting layout diagrams keeps the hub diagram", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "json" ],
        omit: [ "diagram:layout" ] })
    const diagram = objectOf(JSON.parse(json.toString("utf8")), "TYPE", "RecordFrame").diagram
    assert.equal(typeof diagram, "string")
    assert.match(diagram, /^#type hub/)
})

test("HTML export renders both diagrams of a type and the layout fold control", async () => {
    const [ html ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "html" ] })
    const text = html.toString("utf8")
    assert.ok(/data-type=["]?layout/.test(text))
    assert.ok(text.includes("fold-layouts"))
})

test("the functionality view derives a layer diagram from the Layer components", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "json" ] })
    const diagrams = objectOf(JSON.parse(json.toString("utf8")), "ARCH", "Functionality View").diagram
    assert.ok(Array.isArray(diagrams) && diagrams.length === 3)
    const layer = diagrams[1]
    assert.match(layer, /^#type layer/)

    /*  the Layer components become the bands, not nodes, and their
        "PART-OF" references are the layering, not edges  */
    assert.doesNotMatch(layer, /COMPONENT-access-layer:/)
    assert.match(layer, /COMPONENT-gateway: Gateway \[ [^\]]*layer: "Access Layer"/)
    assert.match(layer, /COMPONENT-ingest: Ingest \[ [^\]]*layer: "Core Layer"/)
    assert.doesNotMatch(layer, /part-of|-layer\n/)
    assert.match(layer, /COMPONENT-ingest --> ARCH-FV\.COMPONENT-gateway/)
})

test("a layer diagram marks the upward dependency in the HTML export", async () => {
    const [ html ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "html" ] })
    const text = html.toString("utf8")
    assert.ok(/data-type=["]?layer/.test(text))
    assert.ok(text.includes("fold-layers"))
    assert.ok(text.includes("-alert)"), "the violating edge carries the alert arrow head")
})

test("a functionality view without layers omits the layer diagram", async () => {
    const basedir = variant("25-ARCH-FV-Functionality-View.md", "-   KIND: Layer\n\nThe layer facing",
        "-   KIND: Subsystem\n\nThe layer facing")
    const file = path.join(basedir, "25-ARCH-FV-Functionality-View.md")
    fs.writeFileSync(file, fs.readFileSync(file, "utf8")
        .replace("-   KIND: Layer\n\nThe layer holding", "-   KIND: Subsystem\n\nThe layer holding"), "utf8")
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir, formats: [ "json" ] })
    const diagrams = objectOf(JSON.parse(json.toString("utf8")), "ARCH", "Functionality View").diagram
    assert.deepEqual(diagrams.map((spec) => spec.split("\n")[0]), [ "#type graph", "#type matrix" ])
})

test("the functionality view derives a dependency matrix of the DEPENDS-ON references", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ], basedir: fixture, formats: [ "json" ] })
    const matrix = objectOf(JSON.parse(json.toString("utf8")), "ARCH", "Functionality View").diagram[2]
    assert.match(matrix, /^#type matrix/)

    /*  only the components carrying a dependency remain (the layers
        drop out), and the "PART-OF" references derive no edges  */
    assert.doesNotMatch(matrix, /COMPONENT-access-layer:|COMPONENT-core-layer:/)
    assert.match(matrix, /COMPONENT-gateway --> ARCH-FV\.COMPONENT-ingest/)
    assert.match(matrix, /COMPONENT-ingest --> ARCH-FV\.COMPONENT-gateway/)
    assert.doesNotMatch(matrix, /-layer\n/)
})

test("the test cases derive a traceability matrix of requirements and test cases", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ],
        basedir: path.join(root, "smp", "broadcast"), formats: [ "json" ] })
    const diagrams = objectOf(JSON.parse(json.toString("utf8")), "TEST", "Test Cases").diagram
    assert.ok(Array.isArray(diagrams) && diagrams.length === 2)
    const matrix = diagrams[1]
    assert.match(matrix, /^#type matrix/)

    /*  the test cases are the columns, the requirements the rows, and
        the VERIFIES references the traces  */
    assert.match(matrix, /TEST-TC\.TEST-CASE-valid-token: "Valid Token Grants Access" \[ [^\]]*axis: column/)
    assert.match(matrix, /REQUIREMENT-authentication: "User Authentication" \[ url: [^\]]*\]\n/)
    assert.match(matrix, /TEST-CASE-valid-token --> [^\n]*REQUIREMENT-authentication/)

    /*  a test case verifying a rule which constrains a requirement is
        related to the requirements indirectly, and so is that requirement,
        while a test case of a rule constraining nothing is not  */
    assert.match(matrix, /TEST-CASE-initial-channel: [^\n]*trace: indirect/)
    assert.match(matrix, /REQUIREMENT-provider-switch: [^\n]*\n/)
    assert.doesNotMatch(matrix, /TEST-CASE-valid-token: [^\n]*trace: indirect/)
    assert.doesNotMatch(matrix, /TEST-CASE-no-accounts: [^\n]*trace: indirect/)
})

test("the layers of the sample nest into groups and the datastore is drawn as a database", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ],
        basedir: path.join(root, "smp", "broadcast"), formats: [ "json" ] })
    const layer = objectOf(JSON.parse(json.toString("utf8")), "ARCH", "Functionality View").diagram[1]
    assert.match(layer, /#config layer-numbered true\n/)
    assert.match(layer, /COMPONENT-relay: Relay \[ [^\]]*layer: "Relay Layer", layer-group: "Server Layers\/Broker Layers"/)
    assert.match(layer, /COMPONENT-database: Database \[ [^\]]*layer: "Database Layer", layer-group: "Server Layers", shape: database/)
    assert.match(layer, /COMPONENT-auth: "Authentication Service" \[ [^\]]*layer: "Service Layer"/)
    assert.doesNotMatch(layer, /COMPONENT-server-layers:/)

    /*  the dependency through a consumed and provided interface is
        named after the kind and the transport of that interface  */
    assert.match(layer, /COMPONENT-client --\("MQTT \/ WebSocket"\)--> ARCH-FV\.COMPONENT-relay/)
    assert.match(layer, /COMPONENT-proxy --> ARCH-FV\.COMPONENT-relay/)
})

test("a domain workflow derives a sequence diagram of its handoffs between the actors", async () => {
    const [ json ] = await new SpecBook().export({ config: [ "std" ],
        basedir: path.join(root, "smp", "broadcast"), formats: [ "json" ] })
    const sequence = objectOf(JSON.parse(json.toString("utf8")), "WORKFLOW", "Run Broadcast Event").diagram[1]
    assert.match(sequence, /^#type sequence/)

    /*  the roles are the lifelines (in the order of their first
        appearance), the handoffs the messages in document order  */
    const lines = sequence.split("\n")
    const roles = lines.filter((line) => /^REQS-UP\.ROLE-\S+: /.test(line))
    assert.deepEqual(roles.map((line) => line.split(":")[0]), [ "REQS-UP.ROLE-manager",
        "REQS-UP.ROLE-presenter", "REQS-UP.ROLE-attendee", "REQS-UP.ROLE-moderator" ])
    assert.ok(roles.every((line) => line.includes("shape: person")))
    const messages = lines.filter((line) => line.includes("-->"))
    assert.equal(messages.length, 12)
    assert.match(messages[0], /ROLE-manager --\(import\)--> REQS-UP\.ROLE-manager/)
    assert.match(messages[7], /ROLE-moderator --\(forward\)--> REQS-UP\.ROLE-presenter/)
})
