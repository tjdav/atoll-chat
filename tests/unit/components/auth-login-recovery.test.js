process.env.NODE_ENV = 'test'

import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadComponent } from '../helpers/load-component.js'

describe('Auth Login Recovery Workflow', () => {
  let tagName
  let calls

  const mockGlobalStore = {
    $state: {
      isAuthenticated: false,
      isVaultUnlocked: false,
      currentUser: null,
      pendingRegistrationInvite: null,
      subscribe: (_key, _cb) => {
        return () => {
        }
      }
    }
  }

  const mockAuthApi = {
    recoverAccount: async (username) => {
      calls.recoverAccount.push(username)
      if (username === 'validuser') {
        return {
          user: {
            id: 'user123',
            username: 'validuser',
            recovery_wraps: [{
              salt: 'mockSalt',
              nonce: 'mockNonce',
              ciphertext: 'mockCt'
            }],
            encrypted_private_keys: { ciphertext: 'mockKey' },
            encrypted_master_keys: { ciphertext: 'mockMaster' }
          }
        }
      }
      throw new Error('Invalid or expired recovery code.')
    },
    rotatePassword: async (...args) => {
      calls.rotatePassword.push(args)
      return {
        token: 'mockToken123',
        record: {
          id: 'user123',
          username: 'validuser'
        }
      }
    }
  }

  const mockPocketbase = {
    pb: {
      baseUrl: '/',
      authStore: {
        token: '',
        model: null,
        isValid: false,
        save (token, record) {
          this.token = token
          this.model = record
          this.isValid = Boolean(token)
          calls.authStoreSave.push([token, record])
        }
      },
      buildURL: (path) => path,
      send: async () => ({})
    },
    auth: mockAuthApi
  }

  const mockBiometric = {
    isAvailable: async () => false
  }

  const mockEventBus = {
    $bus: {
      on: () => {
      },
      emit: (event, payload) => {
        calls.busEmit.push({
          event,
          payload
        })
      },
      off: () => {
      }
    }
  }

  const mockCryptoWorker = {
    $worker: {
      execute: async (type, payload) => {
        calls.workerExecute.push({
          type,
          payload
        })
        if (type === 'worker:decrypt_master_key_with_code') {
          if (payload.code === 'RC-1234-5678-9012-3456') {
            return {
              master_key: '00112233445566778899aabbccddeeff',
              auth_proof: 'mockAuthProof123'
            }
          }
          return null
        }
        if (type === 'worker:decrypt_vault') {
          return {
            box_public_key: 'pub',
            box_private_key: 'priv'
          }
        }
        if (type === 'worker:encrypt_master_key_with_kek') {
          return { ciphertext: 'newWrap' }
        }
        return null
      }
    }
  }

  const mockStorage = {
    $storage: {
      saveConfigs: async (configs) => {
        calls.storageSaveConfigs.push(configs)
      }
    }
  }

  const mockRealtimeSync = {
    $sync: {
      startSubscriptions: async () => {
        calls.startSubscriptions.push(true)
      }
    }
  }

  beforeEach(async () => {
    document.body.innerHTML = ''
    localStorage.clear()

    mockGlobalStore.$state.isAuthenticated = false
    mockGlobalStore.$state.isVaultUnlocked = false
    mockGlobalStore.$state.currentUser = null
    mockGlobalStore.$state.pendingRegistrationInvite = null
    mockPocketbase.pb.authStore.token = ''
    mockPocketbase.pb.authStore.model = null
    mockPocketbase.pb.authStore.isValid = false

    calls = {
      recoverAccount: [],
      rotatePassword: [],
      workerExecute: [],
      busEmit: [],
      authStoreSave: [],
      storageSaveConfigs: [],
      startSubscriptions: []
    }

    await loadComponent('atoll-icon')
    await loadComponent('atoll-button')
    await loadComponent('atoll-input')

    tagName = await loadComponent('auth-login', {
      globalStore: mockGlobalStore,
      pocketbase: mockPocketbase,
      storage: mockStorage,
      realtimeSync: mockRealtimeSync,
      cryptoWorker: mockCryptoWorker,
      eventBus: mockEventBus,
      biometric: mockBiometric
    })
  })

  test('should render "Forgot password? Recover with code" button on login view', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    assert.ok(btnShowRecovery, 'btnShowRecovery should be rendered')
    const textAttr = btnShowRecovery.getAttribute('text') || btnShowRecovery.textContent.trim()
    assert.ok(textAttr.includes('Forgot password? Recover with code'))
  })

  test('should switch to viewRecovery and prefill username when btnShowRecovery is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const usernameInput = el.querySelector('[ref$="identity"]')
    if (usernameInput) {
      usernameInput.value = 'john_doe'
      usernameInput.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    const innerBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
    innerBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const viewLogin = el.querySelector('[ref$="viewLogin"]')
    const viewRecovery = el.querySelector('[ref$="viewRecovery"]')

    assert.ok(viewLogin.classList.contains('d-none'), 'viewLogin should be hidden')
    assert.ok(!viewRecovery.classList.contains('d-none'), 'viewRecovery should be visible')

    const recoveryUsernameInput = el.querySelector('[ref$="recoveryUsername"]')
    assert.ok(recoveryUsernameInput, 'recoveryUsername input should exist')
    assert.equal(recoveryUsernameInput.value, 'john_doe', 'recoveryUsername should be prefilled from identity input')
  })

  test('should switch back to viewLogin and clear code when btnCancelRecovery is clicked', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
    const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
    innerShowBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
    recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

    const btnCancelRecovery = el.querySelector('[ref$="btnCancelRecovery"]')
    const innerCancelBtn = btnCancelRecovery.querySelector('button') || btnCancelRecovery
    innerCancelBtn.click()
    await new Promise((resolve) => setTimeout(resolve, 50))

    const viewLogin = el.querySelector('[ref$="viewLogin"]')
    const viewRecovery = el.querySelector('[ref$="viewRecovery"]')

    assert.ok(!viewLogin.classList.contains('d-none'), 'viewLogin should be visible')
    assert.ok(viewRecovery.classList.contains('d-none'), 'viewRecovery should be hidden')
    assert.equal(recoveryCodeInput.value, '', 'recoveryCodeInput should be cleared on cancel')
  })

  test('should auto-format recoveryCodeInput values', async () => {
    const el = document.createElement(tagName)
    document.body.appendChild(el)
    await new Promise((resolve) => setTimeout(resolve, 50))

    const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')

    recoveryCodeInput.value = '1234567890123456'
    recoveryCodeInput.dispatchEvent(new Event('input', { bubbles: true }))

    assert.equal(recoveryCodeInput.value, 'RC-1234-5678-9012-3456', 'Code should auto-format as RC-XXXX-XXXX-XXXX-XXXX')
  })

  describe('Phase A — Recovery Verification', () => {
    test('should successfully verify recovery code and transition to viewNewPassword', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'validuser'
      recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      assert.deepEqual(calls.recoverAccount, ['validuser'])
      const decryptCodeCall = calls.workerExecute.find(c => c.type === 'worker:decrypt_master_key_with_code')
      assert.ok(decryptCodeCall, 'worker:decrypt_master_key_with_code should be called')
      assert.equal(decryptCodeCall.payload.code, 'RC-1234-5678-9012-3456')

      const decryptVaultCall = calls.workerExecute.find(c => c.type === 'worker:decrypt_vault')
      assert.ok(decryptVaultCall, 'worker:decrypt_vault should be called')

      const viewRecovery = el.querySelector('[ref$="viewRecovery"]')
      const viewNewPassword = el.querySelector('[ref$="viewNewPassword"]')
      const statusMsg = el.querySelector('[ref$="statusMsg"]')

      assert.ok(viewRecovery.classList.contains('d-none'), 'viewRecovery should be hidden')
      assert.ok(!viewNewPassword.classList.contains('d-none'), 'viewNewPassword should be visible')
      assert.equal(statusMsg.textContent, 'Code verified! Please set a new password.')
    })

    test('should handle unknown username error path in recovery verification', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'unknownuser'
      recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      assert.deepEqual(calls.recoverAccount, ['unknownuser'])
      const decryptCodeCall = calls.workerExecute.find(c => c.type === 'worker:decrypt_master_key_with_code')
      assert.equal(decryptCodeCall, undefined, 'worker:decrypt_master_key_with_code should NOT be called when recoverAccount fails')

      const viewRecovery = el.querySelector('[ref$="viewRecovery"]')
      assert.ok(!viewRecovery.classList.contains('d-none'), 'viewRecovery should remain visible on error')

      assert.equal(recoveryCodeInput.getAttribute('invalid'), 'true')
      assert.equal(recoveryCodeInput.getAttribute('error-message'), 'Invalid or expired recovery code.')

      const btnVerifyRecovery = el.querySelector('[ref$="btnVerifyRecovery"]')
      assert.equal(btnVerifyRecovery.getAttribute('loading'), null)
    })

    test('should handle wrong recovery code error path', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'validuser'
      recoveryCodeInput.value = 'RC-9999-9999-9999-9999'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      assert.deepEqual(calls.recoverAccount, ['validuser'])
      const decryptCodeCall = calls.workerExecute.find(c => c.type === 'worker:decrypt_master_key_with_code')
      assert.ok(decryptCodeCall, 'worker:decrypt_master_key_with_code should be called')
      assert.equal(decryptCodeCall.payload.code, 'RC-9999-9999-9999-9999')

      const viewRecovery = el.querySelector('[ref$="viewRecovery"]')
      assert.ok(!viewRecovery.classList.contains('d-none'), 'viewRecovery should remain visible on error')

      assert.equal(recoveryCodeInput.getAttribute('invalid'), 'true')
      assert.equal(recoveryCodeInput.getAttribute('error-message'), 'Invalid or expired recovery code.')

      const btnVerifyRecovery = el.querySelector('[ref$="btnVerifyRecovery"]')
      assert.equal(btnVerifyRecovery.getAttribute('loading'), null)
    })

    test('should flag validation errors on empty recovery form submission', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.ok(recoveryForm.classList.contains('was-validated'), 'recoveryForm should have was-validated class')
      assert.equal(calls.recoverAccount.length, 0, 'recoverAccount should not be called on empty submit')

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      assert.equal(recoveryUsername.getAttribute('invalid'), 'true')
      assert.equal(recoveryCodeInput.getAttribute('invalid'), 'true')
    })
  })

  describe('Phase B — New Password Strength Gate', () => {
    test('should disable save button for weak/short password or mismatched confirm, and enable for strong matching password', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'validuser'
      recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      const btnSaveNewPassword = el.querySelector('[ref$="btnSaveNewPassword"]')
      assert.equal(btnSaveNewPassword.getAttribute('disabled'), 'true', 'Save button should start disabled')

      const newPasswordComp = el.querySelector('[ref$="newPassword"]')
      const newPasswordConfirmComp = el.querySelector('[ref$="newPasswordConfirm"]')
      const newPasswordInner = newPasswordComp.querySelector('input') || newPasswordComp
      const newPasswordConfirmInner = newPasswordConfirmComp.querySelector('input') || newPasswordConfirmComp

      // Short password (<12 chars)
      newPasswordInner.value = 'Short1!'
      newPasswordInner.dispatchEvent(new Event('input', { bubbles: true }))
      newPasswordConfirmInner.value = 'Short1!'
      newPasswordConfirmInner.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.equal(btnSaveNewPassword.getAttribute('disabled'), 'true', 'Button should be disabled for short password')

      // Strong password, but mismatched confirm
      newPasswordInner.value = 'CorrectHorseBatteryStaple123!'
      newPasswordInner.dispatchEvent(new Event('input', { bubbles: true }))
      newPasswordConfirmInner.value = 'MismatchPassword123!'
      newPasswordConfirmInner.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.equal(btnSaveNewPassword.getAttribute('disabled'), 'true', 'Button should be disabled for mismatched confirm')

      // Strong password and matching confirm
      newPasswordConfirmInner.value = 'CorrectHorseBatteryStaple123!'
      newPasswordConfirmInner.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.equal(btnSaveNewPassword.getAttribute('disabled'), null, 'Button should be enabled for strong matching password')
    })

    test('should stay on viewNewPassword and flag error when submitted with mismatched confirm', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'validuser'
      recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      const newPasswordComp = el.querySelector('[ref$="newPassword"]')
      const newPasswordConfirmComp = el.querySelector('[ref$="newPasswordConfirm"]')
      const newPasswordInner = newPasswordComp.querySelector('input') || newPasswordComp
      const newPasswordConfirmInner = newPasswordConfirmComp.querySelector('input') || newPasswordConfirmComp

      newPasswordInner.value = 'CorrectHorseBatteryStaple123!'
      newPasswordInner.dispatchEvent(new Event('input', { bubbles: true }))
      newPasswordConfirmInner.value = 'MismatchPassword123!'
      newPasswordConfirmInner.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      const newPasswordForm = el.querySelector('[ref$="newPasswordForm"]')
      newPasswordForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      assert.ok(newPasswordForm.classList.contains('was-validated'), 'newPasswordForm should have was-validated class')
      assert.equal(newPasswordConfirmComp.getAttribute('invalid'), 'true')
      assert.equal(newPasswordConfirmComp.getAttribute('error-message'), 'Passwords do not match.')

      const viewNewPassword = el.querySelector('[ref$="viewNewPassword"]')
      assert.ok(!viewNewPassword.classList.contains('d-none'), 'viewNewPassword should remain visible on submission error')
    })
  })

  describe('Phase C — Final Rotation & Login Cascade', () => {
    test('should complete full password rotation and login cascade upon setting new password', async () => {
      const el = document.createElement(tagName)
      document.body.appendChild(el)
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 1. Enter recovery view
      const btnShowRecovery = el.querySelector('[ref$="btnShowRecovery"]')
      const innerShowBtn = btnShowRecovery.querySelector('button') || btnShowRecovery
      innerShowBtn.click()
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 2. Submit valid recovery code
      const recoveryUsername = el.querySelector('[ref$="recoveryUsername"]')
      const recoveryCodeInput = el.querySelector('[ref$="recoveryCodeInput"]')
      recoveryUsername.value = 'validuser'
      recoveryCodeInput.value = 'RC-1234-5678-9012-3456'

      const recoveryForm = el.querySelector('[ref$="recoveryForm"]')
      recoveryForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 100))

      // 3. Enter new strong matching password
      const newPasswordComp = el.querySelector('[ref$="newPassword"]')
      const newPasswordConfirmComp = el.querySelector('[ref$="newPasswordConfirm"]')
      const newPasswordInner = newPasswordComp.querySelector('input') || newPasswordComp
      const newPasswordConfirmInner = newPasswordConfirmComp.querySelector('input') || newPasswordConfirmComp

      newPasswordInner.value = 'CorrectHorseBatteryStaple123!'
      newPasswordInner.dispatchEvent(new Event('input', { bubbles: true }))
      newPasswordConfirmInner.value = 'CorrectHorseBatteryStaple123!'
      newPasswordConfirmInner.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 50))

      // 4. Submit new password form
      const newPasswordForm = el.querySelector('[ref$="newPasswordForm"]')
      newPasswordForm.dispatchEvent(new Event('submit', {
        bubbles: true,
        cancelable: true
      }))
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Assert worker:encrypt_master_key_with_kek
      const encryptKekCall = calls.workerExecute.find(c => c.type === 'worker:encrypt_master_key_with_kek')
      assert.ok(encryptKekCall, 'worker:encrypt_master_key_with_kek should be called')
      assert.equal(encryptKekCall.payload.master_key, '00112233445566778899aabbccddeeff')

      // Assert authApi.rotatePassword call
      assert.equal(calls.rotatePassword.length, 1, 'rotatePassword should be called once')
      const [newKeyB, newWrappedVMK, remainingWraps, userId, recoveryAuthProof] = calls.rotatePassword[0]
      assert.equal(typeof newKeyB, 'string')
      assert.deepEqual(newWrappedVMK, { ciphertext: 'newWrap' })
      assert.deepEqual(remainingWraps, [], 'Matched wrap index should be spliced out resulting in empty remainingWraps')
      assert.equal(userId, 'user123')
      assert.equal(recoveryAuthProof, 'mockAuthProof123')

      // Assert worker session init calls
      const setTokenCall = calls.workerExecute.find(c => c.type === 'worker:set_token')
      assert.ok(setTokenCall, 'worker:set_token should be called')
      assert.equal(setTokenCall.payload.token, 'mockToken123')

      const initKeysCall = calls.workerExecute.find(c => c.type === 'worker:init_keys')
      assert.ok(initKeysCall, 'worker:init_keys should be called')
      assert.equal(initKeysCall.payload.id, 'user123')

      // Assert pb.authStore.save
      assert.equal(calls.authStoreSave.length, 1)
      assert.equal(calls.authStoreSave[0][0], 'mockToken123')
      assert.equal(calls.authStoreSave[0][1].id, 'user123')

      // Assert $storage.saveConfigs
      assert.equal(calls.storageSaveConfigs.length, 1)
      assert.deepEqual(calls.storageSaveConfigs[0], [
        {
          key: 'pb_url',
          value: '/'
        },
        {
          key: 'pb_token',
          value: 'mockToken123'
        }
      ])

      // Assert bus unlock event and realtime sync
      const unlockedEvent = calls.busEmit.find(e => e.event === 'auth:unlocked')
      assert.ok(unlockedEvent, 'auth:unlocked event should be emitted')
      assert.equal(calls.startSubscriptions.length, 1, 'startSubscriptions should be invoked')

      // Assert global state updates
      assert.equal(mockGlobalStore.$state.isAuthenticated, true)
      assert.equal(mockGlobalStore.$state.isVaultUnlocked, true)

      // Assert final status message
      const statusMsg = el.querySelector('[ref$="statusMsg"]')
      assert.equal(statusMsg.textContent, 'Recovery and password reset complete!')
    })
  })
})
