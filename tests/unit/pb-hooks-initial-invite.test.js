import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

test('PocketBase Hooks - app_config.pb.js, smtp_config.pb.js, and initial_invite.pb.js', async (t) => {
  await t.test('app_config.pb.js sets meta.appName and meta.appURL without throwing Go host object assignment errors', () => {
    let bootstrapFn = null
    let savedSettings = null

    // Mock Go host struct Proxy that throws TypeError on invalid property assignment (like appUrl)
    const allowedMetaFields = new Set(['appName', 'appURL', 'senderName', 'senderAddress'])
    const metaTarget = {
      appName: '',
      appURL: ''
    }
    const mockMetaHostObject = new Proxy(metaTarget, {
      set (target, prop, value) {
        if (!allowedMetaFields.has(prop)) {
          throw new TypeError(`Cannot assign to property ${String(prop)} of a host object`)
        }
        target[prop] = value
        return true
      }
    })

    const mockSettings = {
      meta: mockMetaHostObject
    }

    const mockApp = {
      settings: () => mockSettings,
      save: (settings) => {
        savedSettings = settings
      }
    }

    const mockOs = {
      getenv: (key) => {
        if (key === 'ATOLL_APP_URL') {
          return 'https://chat.example.com'
        }
        return ''
      }
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: mockOs,
      console
    })

    const appConfigHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/app_config.pb.js'), 'utf8')
    vm.runInContext(appConfigHookCode, context)

    assert.equal(typeof bootstrapFn, 'function')

    assert.doesNotThrow(() => {
      bootstrapFn({
        next: () => {
        },
        app: mockApp
      })
    })

    assert.ok(savedSettings, 'e.app.save should have been called')
    assert.equal(mockMetaHostObject.appName, 'Atoll Chat')
    assert.equal(mockMetaHostObject.appURL, 'https://chat.example.com')
  })

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
    assert.ok(sentMessage.html.includes('background-color: #06C755'), 'CTA button should use primary color #06C755')
    assert.ok(sentMessage.html.includes('style="display: inline-block; background-color: #06C755; color: #ffffff !important; font-weight: 600; text-decoration: none; padding: 14px 28px; border-radius: 8px; font-size: 16px;"'), 'CTA button link should have inline style attribute')
  })

  await t.test('initial_invite.pb.js URL resolution cascade and primary button styling', () => {
    let bootstrapFn = null
    let sentMessage = null

    class MockMailerMessage {
      constructor (opts) {
        this.html = opts.html
        this.text = opts.text
      }
    }

    const mockApp = {
      findAllCollections: () => [{ name: 'users' }, { name: 'invitations' }],
      countRecords: () => 0,
      findRecordsByFilter: (coll) => {
        if (coll === 'invitations') {
          return [{ get: (k) => (k === 'code' ? 'INV-URL1-TEST' : null) }]
        }
        if (coll === 'app_metadata') {
          return [{ get: (k) => (k === 'app_url' ? 'https://db-app-url.com' : null) }]
        }
        return []
      },
      settings: () => ({
        smtp: {
          enabled: true,
          host: 'smtp.test.com'
        },
        meta: {
          senderName: 'Atoll',
          senderAddress: 'noreply@atoll.chat',
          appURL: 'https://pb-settings-domain.com'
        }
      }),
      save: () => {
      },
      reloadSettings: () => {
      },
      newMailClient: () => ({
        send: (msg) => {
          sentMessage = msg
        }
      }),
      logger: () => ({
        info: () => {
        },
        warn: () => {
        },
        error: () => {
        }
      })
    }

    const inviteHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/initial_invite.pb.js'), 'utf8')

    // ATOLL_APP_URL takes highest priority
    const context1 = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: {
        getenv: (k) => {
          if (k === 'ATOLL_APP_URL') {
            return 'https://env-atoll-app-url.com'
          }
          if (k === 'ATOLL_OWNER_EMAIL') {
            return 'owner@test.com'
          }
          return ''
        }
      },
      $security: { randomStringWithAlphabet: () => 'TEST' },
      MailerMessage: MockMailerMessage,
      console
    })
    vm.runInContext(inviteHookCode, context1)
    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(sentMessage.html.includes('https://env-atoll-app-url.com/?invite=INV-URL1-TEST'))

    // APP_URL takes priority when ATOLL_APP_URL is absent
    const context2 = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: {
        getenv: (k) => {
          if (k === 'APP_URL') {
            return 'https://env-app-url.com'
          }
          if (k === 'ATOLL_OWNER_EMAIL') {
            return 'owner@test.com'
          }
          return ''
        }
      },
      $security: { randomStringWithAlphabet: () => 'TEST' },
      MailerMessage: MockMailerMessage,
      console
    })
    vm.runInContext(inviteHookCode, context2)
    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(sentMessage.html.includes('https://env-app-url.com/?invite=INV-URL1-TEST'))

    // Fallback to PocketBase settings non-localhost URL when env is absent
    const context3 = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: {
        getenv: (k) => (k === 'ATOLL_OWNER_EMAIL' ? 'owner@test.com' : '')
      },
      $security: { randomStringWithAlphabet: () => 'TEST' },
      MailerMessage: MockMailerMessage,
      console
    })
    vm.runInContext(inviteHookCode, context3)
    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(sentMessage.html.includes('https://pb-settings-domain.com/?invite=INV-URL1-TEST'))

    // Prefer non-localhost DB record over localhost PocketBase settings
    const mockAppLocalhostSettings = {
      ...mockApp,
      settings: () => ({
        smtp: {
          enabled: true,
          host: 'smtp.test.com'
        },
        meta: { appURL: 'http://localhost:8090' }
      })
    }
    const context4 = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: { getenv: (k) => (k === 'ATOLL_OWNER_EMAIL' ? 'owner@test.com' : '') },
      $security: { randomStringWithAlphabet: () => 'TEST' },
      MailerMessage: MockMailerMessage,
      console
    })
    vm.runInContext(inviteHookCode, context4)
    bootstrapFn({
      next: () => {
      },
      app: mockAppLocalhostSettings
    })

    assert.ok(sentMessage.html.includes('https://db-app-url.com/?invite=INV-URL1-TEST'))
  })

  await t.test('app_metadata.pb.js auto-syncs app_url and app_name from non-empty env vars on existing record', () => {
    let bootstrapFn = null
    let savedRecord = null

    const existingRecordData = {
      instance_id: 'inst-123',
      app_url: 'http://localhost:3000',
      app_name: 'Old App Name'
    }

    const mockRecord = {
      get: (k) => existingRecordData[k],
      set: (k, v) => {
        existingRecordData[k] = v
      }
    }

    const mockApp = {
      findAllCollections: () => [{ name: 'app_metadata' }],
      findRecordsByFilter: (coll) => {
        if (coll === 'app_metadata') {
          return [mockRecord]
        }
        return []
      },
      save: (rec) => {
        savedRecord = rec
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
      getenv: (k) => {
        if (k === 'ATOLL_APP_URL') {
          return 'https://new-domain.com'
        }
        if (k === 'ATOLL_APP_NAME') {
          return 'New App Name'
        }
        return ''
      }
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: mockOs,
      console
    })

    const metadataHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/app_metadata.pb.js'), 'utf8')
    vm.runInContext(metadataHookCode, context)

    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.ok(savedRecord, 'Record should be saved when env vars differ from DB record')
    assert.equal(existingRecordData.app_url, 'https://new-domain.com')
    assert.equal(existingRecordData.app_name, 'New App Name')
  })

  await t.test('app_metadata.pb.js ignores empty environment variables to preserve existing database values', () => {
    let bootstrapFn = null
    let savedRecord = null

    const existingRecordData = {
      instance_id: 'inst-123',
      app_url: 'https://my-custom-app.com',
      app_name: 'My Custom App'
    }

    const mockRecord = {
      get: (k) => existingRecordData[k],
      set: (k, v) => {
        existingRecordData[k] = v
      }
    }

    const mockApp = {
      findAllCollections: () => [{ name: 'app_metadata' }],
      findRecordsByFilter: (coll) => {
        if (coll === 'app_metadata') {
          return [mockRecord]
        }
        return []
      },
      save: (rec) => {
        savedRecord = rec
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
      getenv: () => ''
    }

    const context = vm.createContext({
      onBootstrap: (fn) => {
        bootstrapFn = fn
      },
      $os: mockOs,
      console
    })

    const metadataHookCode = fs.readFileSync(path.resolve(process.cwd(), 'database/pb_hooks/app_metadata.pb.js'), 'utf8')
    vm.runInContext(metadataHookCode, context)

    bootstrapFn({
      next: () => {
      },
      app: mockApp
    })

    assert.equal(savedRecord, null, 'Record should NOT be saved when env vars are empty')
    assert.equal(existingRecordData.app_url, 'https://my-custom-app.com')
    assert.equal(existingRecordData.app_name, 'My Custom App')
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
