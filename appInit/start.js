import { config as strategyChooserConfig } from './Init/strategyChooser_Live.js';
import { config as webSocketListeningConfig } from './Init/webSocketListening_Live.js';
import { main as baseInitMain } from './Init/base_init.js';

baseInitMain(strategyChooserConfig).catch(console.error);
baseInitMain(webSocketListeningConfig).catch(console.error);
