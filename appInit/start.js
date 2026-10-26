import { config as strategyChooserConfig } from './Init/strategyChooser_Live.js';
import { config as webSocketListeningConfig } from './Init/webSocketListening_Live.js';
import { main as baseInitMain } from './Init/base_init.js';

 
// Execute initializations sequentially to prevent race conditions with shared resources.
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
