#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later

import { scanLibrary, loadRecipeById } from './recipe/library.js'
import { compile } from './compiler/index.js'
import { version } from './index.js'

const USAGE = `Usage:
  atoll-recipes list <rootDir>
  atoll-recipes verify <rootDir> [<id>]
  atoll-recipes --version
`

/**
 * Writes a line to a stream.
 * @param {object} stream - The writable stream.
 * @param {string} line - The line to write.
 * @returns {void}
 */
function writeLine (stream, line) {
  stream.write(line + '\n')
}

/**
 * Runs the `list` command. Prints a summary line per recipe, sorted
 * by id. Valid recipes first, then invalid recipes as errors.
 * @param {string} rootDir - The library root.
 * @param {object} io - The stdout and stderr streams.
 * @returns {Promise<number>} The exit code.
 */
async function runList (rootDir, io) {
  let scan
  try {
    scan = await scanLibrary(rootDir)
  } catch (err) {
    writeLine(io.stderr, `error: ${err.message}`)
    return 1
  }

  for (const recipe of scan.recipes) {
    writeLine(io.stdout, `${recipe.id}@${recipe.version} — ${recipe.label}`)
  }
  for (const error of scan.errors) {
    writeLine(io.stderr, `${error.path}: ${error.message}`)
  }

  writeLine(io.stdout, `\n${scan.recipes.length} recipe(s), ${scan.errors.length} error(s)`)
  return 0
}

/**
 * Verifies a single recipe by loading it, then compiling it with an
 * empty instantiation. Returns null on success, or an error message
 * on failure.
 *
 * A recipe that requires a slot with no default cannot compile with
 * an empty instantiation. The compiler's error message is returned
 * verbatim — the CLI does not attempt to distinguish slot errors
 * from other failures.
 * @param {string} rootDir - The library root.
 * @param {string} id - The recipe id.
 * @returns {Promise<string | null>} Null on success, error message
 *   on failure.
 */
async function verifyRecipe (rootDir, id) {
  let recipe
  try {
    recipe = await loadRecipeById(rootDir, id)
  } catch (err) {
    return err.message
  }

  try {
    await compile(
      rootDir,
      { recipeId: recipe.id, recipeVersion: recipe.version, slots: {} },
      { botId: 'com.example.verify', label: 'Verify' }
    )
  } catch (err) {
    return err.message
  }

  return null
}

/**
 * Runs the `verify` command. Verifies one recipe when an id is
 * given, otherwise every recipe in the library.
 * @param {string} rootDir - The library root.
 * @param {string | undefined} id - The recipe id, or undefined.
 * @param {object} io - The stdout and stderr streams.
 * @returns {Promise<number>} The exit code.
 */
async function runVerify (rootDir, id, io) {
  const ids = []
  if (id !== undefined) {
    ids.push(id)
  } else {
    let scan
    try {
      scan = await scanLibrary(rootDir)
    } catch (err) {
      writeLine(io.stderr, `error: ${err.message}`)
      return 1
    }
    for (const error of scan.errors) {
      writeLine(io.stderr, `${error.path}: ${error.message}`)
    }
    for (const recipe of scan.recipes) {
      ids.push(recipe.id)
    }
  }

  let failures = 0
  for (const recipeId of ids) {
    const error = await verifyRecipe(rootDir, recipeId)
    if (error === null) {
      writeLine(io.stdout, `ok  ${recipeId}`)
    } else {
      failures++
      writeLine(io.stderr, `fail ${recipeId}: ${error}`)
    }
  }

  if (failures === 0) {
    writeLine(io.stdout, `\n${ids.length} verified`)
    return 0
  }
  writeLine(io.stderr, `\n${failures} of ${ids.length} failed`)
  return 1
}

/**
 * Runs the CLI. Returns the exit code. Does not call process.exit;
 * the binary entry point does that.
 * @param {string[]} args - The command-line arguments, without the
 *   node and script path.
 * @param {object} io - The output streams.
 * @param {object} io.stdout - Writable stream for normal output.
 * @param {object} io.stderr - Writable stream for errors.
 * @returns {Promise<number>} The exit code.
 */
export async function run (args, io) {
  if (args.length === 0) {
    io.stderr.write(USAGE)
    return 2
  }

  const command = args[0]

  if (command === '--version' || command === '-v') {
    writeLine(io.stdout, version)
    return 0
  }

  if (command === 'list') {
    if (args.length !== 2) {
      io.stderr.write(USAGE)
      return 2
    }
    return runList(args[1], io)
  }

  if (command === 'verify') {
    if (args.length !== 2 && args.length !== 3) {
      io.stderr.write(USAGE)
      return 2
    }
    return runVerify(args[1], args[2], io)
  }

  io.stderr.write(`error: unknown command "${command}"\n`)
  io.stderr.write(USAGE)
  return 2
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('/cli.js')
if (isMain) {
  run(process.argv.slice(2), { stdout: process.stdout, stderr: process.stderr })
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(`internal error: ${err.message}\n`)
      process.exit(2)
    })
}
