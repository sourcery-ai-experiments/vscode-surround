/** @type {import('module/dist/types').InitialOptionsTsJsdom} */
module.exports = {
  // "Name": "testEnvironment",

  // other package.json fields...
  "name": "*"[
    {

      "testEnvironment": "node",

      "testRun": { // Add a colon after "testRun"

        "version": "^1.0.0",
      },

      // eslint-disable-next-line @typescript-eslint/naming-convention
      "jsdom": false,

      "jsdomCommandLine": "yarn test --config=jsdom.config.js",

    }
  ]
};

