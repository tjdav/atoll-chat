import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

test('PocketBase Hooks - smtp_config.pb.js and initial_invite.pb.js', async (t) => {
  await t.test('smtp_config.pb.js properly sets SMTP settings on app.settings() and saves', () => {
    let bootstrapFn = null
    let savedSettings = null
    let reloadedSettingsCalled = false

    const mockApp = {
      settings: () => ({
        smtp: {
          enabled: false,
          host: '',
          port: 0
        },
        meta: {
          senderName: '',
          senderAddress: ''
        }
      }),
      save: (settings) => {
        savedSettings = settings
      },
      reloadSettings: () => {
        reloadedSettingsCalled = true
      }
    }

    const mockOs = {
      getenv: (key) => {
        const env = {
          ATOLL_SMTP_HOST: 'smtp.example.com',
          ATOLL_SMTP_PORT: '587',
          ATOLL_SMTP_ENABLED: 'true',
          ATOLL_SMTP_USERNAME: 'user@example.com',
          ATOLL_SMTP_PASSWORD: 'password123',
          ATOLL_SMTP_SENDER_NAME: 'Atoll Test',
          ATOLL_SMTP_SENDER_ADDRESS: 'noreply@example.com'
        }
        return env[key] || ''
      }
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: mockOs,
      console
    })

    const smtpHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/smtp_config.pb.js'), 'utf8')
    vm.runInContext(smtpHookCode, context)

    assert.equal(typeof bootstrapFn, 'function')

    // Simulate PocketBase bootstrap event execution
    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(savedSettings, 'app.save should have been called with updated settings')
    assert.equal(savedSettings.smtp.enabled, true)
    assert.equal(savedSettings.smtp.host, 'smtp.example.com')
    assert.equal(savedSettings.smtp.port, 587)
    assert.equal(savedSettings.smtp.username, 'user@example.com')
    assert.equal(savedSettings.meta.senderName, 'Atoll Test')
    assert.equal(reloadedSettingsCalled, true, 'app.reloadSettings() should be called to refresh in-memory settings')
  })

  await t.test('initial_invite.pb.js applies SMTP, reloads settings, and dispatches MailerMessage when users count is 0', () => {
    let bootstrapFn = null
    let savedSettings = null
    let reloadedSettingsCalled = false
    let sentMessage = null
    let inviteSavedRecord = null

    class MockMailerMessage {
      constructor (opts) {
        this.from = opts.from
        this.to = opts.to
        this.subject = opts.subject
        this.html = opts.html
        this.text = opts.text
      }
    }

    class MockRecord {
      constructor (collection) {
        this.collection = collection
        this.data = {}
      }

      set (key, value) {
        this.data[key] = value
      }

      get (key) {
        return this.data[key]
      }
    }

    class MockDynamicModel {
      constructor (data) {
        Object.assign(this, data)
      }
    }

    const currentSettings = {
      smtp: {
        enabled: false,
        host: ''
      },
      meta: {
        senderName: 'Atoll Chat',
        senderAddress: 'noreply@atoll.chat'
      }
    }

    const mockApp = {
      findAllCollections: () => [
        {
          name: 'users'
        },
        {
          name: 'invitations'
        }
      ],
      countRecords: (coll) => {
        if (coll === 'users') {
          return 0
        }
        return 0
      },
      findRecordsByFilter: (coll) => {
        if (coll === 'invitations') {
          return []
        }
        if (coll === 'app_metadata') {
          return []
        }
        return []
      },
      settings: () => currentSettings,
      save: (item) => {
        if (item.smtp) {
          savedSettings = item
        } else {
          inviteSavedRecord = item
        }
      },
      reloadSettings: () => {
        reloadedSettingsCalled = true
      },
      newMailClient: () => {
        if (!currentSettings.smtp.enabled || !currentSettings.smtp.host) {
          throw new Error('SMTP mail client disabled or missing host')
        }
        return {
          send: (msg) => {
            sentMessage = msg
          }
        }
      },
      logger: () => ({
        info: () => {
        },
        warn: () => {
        },
        error: () => {
        }
      })
    }

    const mockOs = {
      getenv: (key) => {
        const env = {
          ATOLL_SMTP_HOST: 'smtp.test.com',
          ATOLL_SMTP_PORT: '587',
          ATOLL_OWNER_EMAIL: 'owner@atoll.test',
          ATOLL_APP_URL: 'https://atoll.test'
        }
        return env[key] || ''
      }
    }

    const mockSecurity = {
      randomStringWithAlphabet: (_len) => 'TEST'
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: mockOs,
      $security: mockSecurity,
      MailerMessage: MockMailerMessage,
      Record: MockRecord,
      DynamicModel: MockDynamicModel,
      console
    })

    const inviteHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/initial_invite.pb.js'), 'utf8')
    vm.runInContext(inviteHookCode, context)

    assert.equal(typeof bootstrapFn, 'function')

    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(savedSettings, 'applySmtpSettings should save updated SMTP settings')
    assert.equal(savedSettings.smtp.host, 'smtp.test.com')
    assert.equal(savedSettings.smtp.enabled, true)
    assert.equal(reloadedSettingsCalled, true, 'app.reloadSettings() should be called in applySmtpSettings')

    assert.ok(inviteSavedRecord, 'Initial invite code record should be created and saved')
    assert.equal(inviteSavedRecord.get('code'), 'INV-TEST-TEST')

    assert.ok(sentMessage, 'MailerMessage should be instantiated and dispatched via app.newMailClient().send()')
    assert.equal(sentMessage.to[0].address, 'owner@atoll.test')
    assert.equal(sentMessage.subject, 'Atoll Chat - Complete Initial Owner Setup')
    assert.ok(sentMessage.html.includes('https://atoll.test/?invite=INV-TEST-TEST'))
  })

  await t.test('initial_invite.pb.js skips sending email if user count is greater than 0', () => {
    let bootstrapFn = null
    let mailSent = false

    const mockApp = {
      findAllCollections: () => [
        {
          name: 'users'
        },
        {
          name: 'invitations'
        }
      ],
      countRecords: (coll) => {
        if (coll === 'users') {
          return 5
        }
        return 0
      },
      settings: () => ({
        smtp: {},
        meta: {}
      }),
      newMailClient: () => ({
        send: () => {
          mailSent = true
        }
      }),
      logger: () => ({
        error: () => {
        }
      })
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: {
        getenv: () => ''
      },
      console
    })

    const inviteHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/initial_invite.pb.js'), 'utf8')
    vm.runInContext(inviteHookCode, context)

    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.equal(mailSent, false, 'Should not dispatch setup email when users already exist')
  })
})
