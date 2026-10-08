import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRDesignMcpServer } from './server.js';
const server = createRDesignMcpServer();
await server.connect(new StdioServerTransport());
process.on('SIGINT',()=>{void server.close().finally(()=>process.exit(0));});
