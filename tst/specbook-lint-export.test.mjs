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
