import { execFile } from 'node:child_process'

/**
 * Runs a command and returns its stdout. Rejects when the command
 * exits non-zero or times out.
 *
 * @typedef {(cmd: string, args: string[], opts?: { input?: string, timeoutMs?: number }) => Promise<string>} Runner - The command runner function.
 */

/**
 * Default command runner using child_process.execFile.
 *
 * @type {Runner}
 */
const defaultRunner = (cmd, args, opts = {}) => {
  return new Promise((resolve, reject) => {
    const timeout = opts.timeoutMs ?? 10_000
    const child = execFile(cmd, args, {
      timeout,
      encoding: 'utf8'
    }, (err, stdout, stderr) => {
      if (err) {
        const error = Object.assign(err, { stderr })
        reject(error)
        return
      }
      resolve(stdout)
    })

    if (opts.input && child.stdin) {
      child.stdin.write(opts.input)
      child.stdin.end()
    }
  })
}

const WINDOWS_SCRIPT_TEMPLATE = `$ErrorActionPreference = 'Stop'
$sig = @'
using System;
using System.Runtime.InteropServices;
public class AtollCred {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredRead(string target, int type, int reserved, out IntPtr credentialPtr);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  public static string Read(string target) {
    IntPtr ptr;
    if (!CredRead(target, 1, 0, out ptr)) return null;
    try {
      var cred = (CREDENTIAL)Marshal.PtrToStructure(ptr, typeof(CREDENTIAL));
      var bytes = new byte[cred.CredentialBlobSize];
      Marshal.Copy(cred.CredentialBlob, bytes, 0, (int)cred.CredentialBlobSize);
      return System.Text.Encoding.Unicode.GetString(bytes);
    } finally {
      CredFree(ptr);
    }
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction Stop
$pw = [AtollCred]::Read('__TARGET__')
if ($null -eq $pw) { exit 2 }
Write-Output $pw`

/**
 * Creates a resolver that reads the keystore passphrase from the
 * platform's credential store.
 *
 * On unsupported platforms, returns a resolver that always defers.
 *
 * @param {object} [options] - Options for the keychain resolver.
 * @param {string} [options.platform=process.platform] - The platform
 *   identifier to dispatch on. Parameterized for testing.
 * @param {Runner} [options.runner] - The command runner. Defaults to a
 *   child_process.execFile-based runner. Parameterized for testing.
 * @returns {import('./index.js').Resolver} - The keychain resolver.
 */
export function keychainResolver ({
  platform = process.platform,
  runner = defaultRunner
} = {}) {
  let id = 'keychain:unsupported'
  if (platform === 'darwin') {
    id = 'keychain:darwin'
  } else if (platform === 'linux') {
    id = 'keychain:linux'
  } else if (platform === 'win32') {
    id = 'keychain:win32'
  }

  return {
    id,
    async resolve (ctx) {
      if (id === 'keychain:unsupported') {
        return null
      }

      try {
        if (platform === 'darwin') {
          const cmd = '/usr/bin/security'
          const args = ['find-generic-password', '-s', 'atoll-bot', '-a', ctx.botId, '-w']
          const output = await runner(cmd, args)
          return output.replace(/[\r\n]+$/, '')
        }

        if (platform === 'linux') {
          const cmd = 'secret-tool'
          const args = ['lookup', 'service', 'atoll-bot', 'account', ctx.botId]
          const output = await runner(cmd, args)
          return output.replace(/[\r\n]+$/, '')
        }

        if (platform === 'win32') {
          const cmd = 'powershell.exe'
          const args = ['-NoProfile', '-NonInteractive', '-Command', '-']
          const target = `atoll-bot:${ctx.botId}`
          const input = WINDOWS_SCRIPT_TEMPLATE.replace('__TARGET__', target)
          const output = await runner(cmd, args, { input })
          return output.replace(/[\r\n]+$/, '')
        }
      } catch {
        return null
      }

      return null
    }
  }
}
