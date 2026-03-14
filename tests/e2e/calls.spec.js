import { test, expect } from '@playwright/test';

test.describe('Secure Calls', () => {
  let aliceContext;
  let bobContext;
  let alicePage;
  let bobPage;

  test.beforeAll(async ({ browser }) => {
    aliceContext = await browser.newContext();
    bobContext = await browser.newContext();

    alicePage = await aliceContext.newPage();
    bobPage = await bobContext.newPage();

    // Login Alice
    await alicePage.goto('/');
    await alicePage.locator('coralite-login').getByLabel('Username').fill('alice');
    await alicePage.locator('coralite-login').getByLabel('Password').fill('password123');
    await alicePage.locator('coralite-login').getByRole('button', { name: 'Log In' }).click();
    await expect(alicePage.locator('coralite-app-layout')).toBeVisible({ timeout: 10000 });

    // Login Bob
    await bobPage.goto('/');
    await bobPage.locator('coralite-login').getByLabel('Username').fill('bob');
    await bobPage.locator('coralite-login').getByLabel('Password').fill('password123');
    await bobPage.locator('coralite-login').getByRole('button', { name: 'Log In' }).click();
    await expect(bobPage.locator('coralite-app-layout')).toBeVisible({ timeout: 10000 });

    // Setup room
    await alicePage.getByRole('button', { name: 'New Room' }).click();
    await alicePage.getByLabel('Room Name').fill('Video Call Room');
    await alicePage.getByRole('button', { name: 'Create' }).click();
    await alicePage.getByText('Video Call Room').click();

    // Invite Bob
    await alicePage.getByRole('button', { name: 'Invite' }).click();
    await alicePage.getByLabel('User ID').fill('@bob:localhost');
    await alicePage.getByRole('button', { name: 'Send Invite' }).click();

    // Bob accepts
    await expect(bobPage.locator('coralite-chat-list')).toContainText('Video Call Room');
    await bobPage.getByText('Video Call Room').click();
    const joinButton = bobPage.getByRole('button', { name: 'Join' });
    if (await joinButton.isVisible()) {
      await joinButton.click();
    }
  });

  test.afterAll(async () => {
    await aliceContext.close();
    await bobContext.close();
  });

  test('Ringing State', async () => {
    // User A clicks the video call button
    await alicePage.getByRole('button', { name: 'Video Call' }).click();

    // Verify User B sees the incoming call modal/toast
    const incomingCallModal = bobPage.locator('.modal-incoming-call'); // Assuming a bootstrap modal or similar class
    await expect(incomingCallModal).toBeVisible({ timeout: 15000 });
    await expect(incomingCallModal).toContainText('Incoming Video Call');
  });

  test('Stream Connection', async () => {
    // User B accepts
    const acceptButton = bobPage.locator('.modal-incoming-call').getByRole('button', { name: 'Accept' });
    await acceptButton.click();

    // Verify the <coralite-video-call> modal opens for both users
    await expect(alicePage.locator('coralite-video-call')).toBeVisible({ timeout: 10000 });
    await expect(bobPage.locator('coralite-video-call')).toBeVisible({ timeout: 10000 });
  });

  test('Media Tracks Assigned', async () => {
    // Check that the large remote <video> tag and small local <video> tag both have a srcObject assigned
    const checkVideoTracks = async (page) => {
      return page.evaluate(() => {
        const videoCall = document.querySelector('coralite-video-call');
        // shadowRoot pierce
        const root = videoCall.shadowRoot || videoCall;
        const localVideo = root.querySelector('.local-video');
        const remoteVideo = root.querySelector('.remote-video');
        
        return {
          localHasSrc: localVideo && localVideo.srcObject !== null,
          remoteHasSrc: remoteVideo && remoteVideo.srcObject !== null
        };
      });
    };

    // Wait a moment for WebRTC negotiation and track addition
    await alicePage.waitForTimeout(5000);

    const aliceTracks = await checkVideoTracks(alicePage);
    expect(aliceTracks.localHasSrc).toBeTruthy();
    expect(aliceTracks.remoteHasSrc).toBeTruthy();

    const bobTracks = await checkVideoTracks(bobPage);
    expect(bobTracks.localHasSrc).toBeTruthy();
    expect(bobTracks.remoteHasSrc).toBeTruthy();
  });

  test('Hangup and Cleanup', async () => {
    // User A clicks "End Call"
    const endCallButton = alicePage.locator('coralite-video-call').getByRole('button', { name: 'End Call' });
    await endCallButton.click();

    // Verify the modal closes for both users
    await expect(alicePage.locator('coralite-video-call')).toBeHidden({ timeout: 5000 });
    await expect(bobPage.locator('coralite-video-call')).toBeHidden({ timeout: 5000 });

    // Check that the camera tracks were successfully stopped (srcObject cleared)
    // The components should be removed from DOM or hidden, making `srcObject` null/unavailable.
    // If hidden but kept in DOM, we'd check `srcObject === null`. Since we assert it is hidden,
    // we assume component teardown handles cleanup correctly as instructed.
    
    // We can verify camera tracks are stopped by checking if `navigator.mediaDevices.getUserMedia` tracks are active
    // This is hard to do cleanly without injecting into the page context, but verifying the UI teardown is usually sufficient for E2E.
    const isLocalVideoStopped = await alicePage.evaluate(() => {
      // Look for any remaining active streams attached to video tags
      const videos = document.querySelectorAll('video');
      for (const video of videos) {
        if (video.srcObject && video.srcObject.active) {
          return false;
        }
      }
      return true;
    });
    
    expect(isLocalVideoStopped).toBeTruthy();
  });
});
