#!/usr/bin/env node
import { dispatch } from './cli/index.js'

const code = await dispatch(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr
})
process.exitCode = code
