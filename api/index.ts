// Vercel Node.js Serverless Function entry point.
//
// Unlike Netlify (which needed serverless-http + connectLambda to adapt an
// Express app to its Lambda-compatibility layer), Vercel's Node.js runtime
// accepts a plain (req, res) handler - and an Express app IS exactly that.
// So we can export it directly, no adapter needed.
import { app } from '../server.js';

export default app;
