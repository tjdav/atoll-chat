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
public class AtollCredWrite {
  [DllImport("advapi32.dll", SetLastError=true, CharSet=CharSet.Unicode)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
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
  public static bool Write(string target, string user, string password) {
    var passwordBytes = System.Text.Encoding.Unicode.GetBytes(password);
    var blob = Marshal.AllocHGlobal(passwordBytes.Length);
    var targetPtr = Marshal.StringToCoTaskMemUni(target);
    var userPtr = Marshal.StringToCoTaskMemUni(user);
    try {
      Marshal.Copy(passwordBytes, 0, blob, passwordBytes.Length);
      var cred = new CREDENTIAL {
        Flags = 0,
        Type = 1,
        TargetName = targetPtr,
        Comment = IntPtr.Zero,
        CredentialBlobSize = (uint)passwordBytes.Length,
        CredentialBlob = blob,
        Persist = 2,
        AttributeCount = 0,
        Attributes = IntPtr.Zero,
        TargetAlias = IntPtr.Zero,
        UserName = userPtr
      };
      return CredWrite(ref cred, 0);
    } finally {
      Marshal.FreeCoTaskMem(targetPtr);
      Marshal.FreeCoTaskMem(userPtr);
      Marshal.FreeHGlobal(blob);
    }
  }
}
'@
Add-Type -TypeDefinition $sig -ErrorAction Stop
$pw = [Console]::In.ReadToEnd()
$ok = [AtollCredWrite]::Write('__TARGET__', 'bot', $pw)
if (-not $ok) { exit 1 }`

/**
 * Writes a passphrase to the platform's credential store.
 *
 * @typedef {(botId: string, secret: string) => Promise<void>} Writer - Writes passphrase to credential store.
 */

/**
 * Creates a writer that stores the passphrase in the platform's
 * credential store.
 *
 * On unsupported platforms, returns a no-op writer.
 *
 * @param {object} [options] - Options for keychain writer.
 * @param {string} [options.platform=process.platform] - The platform
 *   identifier to dispatch on. Parameterized for testing.
 * @param {Runner} [options.runner] - The command runner. Defaults to a
 *   child_process.execFile-based runner. Parameterized for testing.
 * @returns {Writer} The writer.
 */
export function keychainWriter ({
  platform = process.platform,
  runner = defaultRunner
} = {}) {
  if (platform !== 'darwin' && platform !== 'linux' && platform !== 'win32') {
    return async () => {
      // No-op on unsupported platforms.
    }
  }

  return async (botId, secret) => {
    if (platform === 'darwin') {
      const cmd = '/usr/bin/security'
      const args = ['add-generic-password', '-s', 'atoll-bot', '-a', botId, '-U', '-w']
      await runner(cmd, args, { input: secret })
      return
    }

    if (platform === 'linux') {
      const cmd = 'secret-tool'
      const args = ['store', '--label', `Atoll bot ${botId}`, 'service', 'atoll-bot', 'account', botId]
      await runner(cmd, args, { input: secret })
      return
    }

    if (platform === 'win32') {
      const cmd = 'powershell.exe'
      const target = `atoll-bot:${botId}`
      const script = WINDOWS_SCRIPT_TEMPLATE.replace('__TARGET__', target)
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      const args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded]
      await runner(cmd, args, { input: secret })
    }
  }
}
