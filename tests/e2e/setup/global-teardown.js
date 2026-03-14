import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function globalTeardown() {
  console.log('Stopping Dendrite local server via Docker Compose...');
  try {
    await execAsync('docker-compose down -v');
    console.log('Dendrite server stopped and volumes removed.');
  } catch (err) {
    console.error('Error in global teardown:', err);
  }
}

export default globalTeardown;