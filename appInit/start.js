import { config as strategyChooserConfig } from './Init/strategyChooser_Live.js';
import { config as webSocketListeningConfig } from './Init/webSocketListening_Live.js';
import { main as baseInitMain } from './Init/base_init.js';

 
// Wrap in an async IIFE (Immediately Invoked Function Expression) to run initializations sequentially.
// This prevents race conditions where one initialization might disconnect a shared resource (like Redis)
// while another is still using it.
(async () => {
    try {
        console.log('Initializing Strategy Chooser...');
        await baseInitMain(strategyChooserConfig);
        console.log('Strategy Chooser initialized successfully.');
 
        console.log('\nInitializing WebSocket Listening...');
        await baseInitMain(webSocketListeningConfig);
        console.log('WebSocket Listening initialized successfully.');
 
        console.log('\nAll initializations complete.');
    } catch (error) {
        console.error('An error occurred during initialization:', error);
        process.exit(1); // Exit with a non-zero code to indicate failure
    }
})();
