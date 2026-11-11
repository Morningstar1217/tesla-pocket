import { createServer } from 'node:http';
import { readConfig } from './config.mjs';
import { createHandler } from './app.mjs';

try {
  const config = readConfig();
  const server = createServer(createHandler(config));
  server.on('error', () => { console.error('服务启动失败，请检查地址与端口。'); process.exitCode = 1; });
  server.listen(config.port, config.host, () => {
    console.log(`Tesla Pocket: http://${config.host}:${config.port} (${config.upstream ? '真实只读数据' : '演示数据'})`);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
