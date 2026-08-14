// Local development server, with the QA screenshot sink switched on.
//
//   npm run dev
//
// The sink writes files, so it is off in `npm start` and off in `npm run share`.
// This is the one entry point that turns it on, and it is for your own machine.
process.env.AR_DEV_SHOTS = '1';
await import('../server.js');
