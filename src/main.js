let debug = require('debug')('taskcluster-github');
let api = require('./api');
let path = require('path');
let Promise = require('promise');
let exchanges = require('./exchanges');
let Handlers = require('./handlers');
let Intree = require('./intree');
let data = require('./data');
let _ = require('lodash');
let taskcluster = require('taskcluster-client');
let Github = require('github');
let config = require('typed-env-config');
let monitor = require('taskcluster-lib-monitor');
let validator = require('taskcluster-lib-validate');
let loader = require('taskcluster-lib-loader');
let docs = require('taskcluster-lib-docs');
let App = require('taskcluster-lib-app');

let load = loader({
  cfg: {
    requires: ['profile'],
    setup: ({profile}) => config({profile}),
  },

  monitor: {
    requires: ['process', 'profile', 'cfg'],
    setup: ({process, profile, cfg}) => {
      console.log('b monitor');
      let qqq =monitor({
      project: cfg.app.name,
      credentials: cfg.taskcluster.credentials,
      mock: profile === 'test',
      process,
    });
      console.log('a monitor');
      return qqq;
    },
  },

  validator: {
    requires: ['cfg'],
    setup: ({cfg}) => {
      console.log('HI');
      let aaa = validator({
        prefix: 'github/v1/',
        aws: cfg.aws,
      });
      console.log('BYE');
      return aaa;
    },
  },

  docs: {
    requires: ['cfg', 'validator', 'reference'],
    setup: ({cfg, validator, reference}) => docs.documenter({
      credentials: cfg.taskcluster.credentials,
      tier: 'core',
      schemas: validator.schemas,
      project: 'github',
      references: [
        {
          name: 'api',
          reference: api.reference({baseUrl: cfg.server.publicUrl + '/v1'}),
        }, {
          name: 'events',
          reference: reference,
        },
      ],
    }),
  },

  publisher: {
    requires: ['cfg', 'monitor', 'validator'],
    setup: async ({cfg, monitor, validator}) => {
      console.log('before publisher');
      let qqq = exchanges.setup({
      credentials:        cfg.pulse,
      exchangePrefix:     cfg.app.exchangePrefix,
      validator:          validator,
      referencePrefix:    'github/v1/exchanges.json',
      publish:            process.env.NODE_ENV === 'production',
      aws:                cfg.aws,
      monitor:            monitor.prefix('publisher'),
    });
      console.log('after publisher');
      return qqq;
    },
  },

  github: {
    requires: ['cfg'],
    setup: ({cfg}) => {
      console.log('before gh');
      let github = new Github({
        promise: Promise,
      });
      if (cfg.github.credentials.token) {
        github.authenticate(cfg.github.credentials);
      }
      console.log('after gh');
      return github;
    },
  },

  intree: {
    requires: ['cfg'],
    setup: ({cfg}) => Intree.setup(cfg),
  },

  Builds: {
    requires: ['cfg', 'monitor'],
    setup: async ({cfg, monitor}) => {
      console.log('before BUILDS');
      var build = await data.Build.setup({
        account: cfg.azure.account,
        table: cfg.app.buildTableName,
        credentials: cfg.taskcluster.credentials,
        monitor: monitor.prefix(cfg.app.buildTableName.toLowerCase()),
      });
      console.log('after BUILDS');

      await build.ensureTable();
      return build;
    },
  },

  api: {
    requires: ['cfg', 'monitor', 'validator', 'github', 'publisher', 'Builds'],
    setup: ({cfg, monitor, validator, github, publisher, Builds}) => {
      console.log('before api');
        let qqq = api.setup({
          context:          {publisher, cfg, github, Builds},
          authBaseUrl:      cfg.taskcluster.authBaseUrl,
          publish:          process.env.NODE_ENV === 'production',
          baseUrl:          cfg.server.publicUrl + '/v1',
          referencePrefix:  'github/v1/api.json',
          aws:              cfg.aws,
          monitor:          monitor.prefix('api'),
          validator,
      });
      console.log('after api');
      return qqq;
    }
  },

  server: {
    requires: ['cfg', 'api', 'docs'],
    setup: ({cfg, api, docs}) => {

      debug('Launching server.');
      let app = App(cfg.server);
      app.use('/v1', api);
      return app.createServer();
    },
  },

  reference: {
    requires: ['cfg'],
    setup: ({cfg}) => exchanges.reference({
      exchangePrefix:   cfg.app.exchangePrefix,
      credentials:      cfg.pulse,
    }),
  },

  handlers: {
    requires: ['cfg', 'github', 'monitor', 'intree', 'validator', 'reference', 'Builds'],
    setup: async ({cfg, github, monitor, intree, validator, reference, Builds}) => new Handlers({
      credentials: cfg.pulse,
      monitor: monitor.prefix('handlers'),
      intree,
      reference,
      jobQueueName: cfg.app.jobQueueName,
      statusQueueName: cfg.app.statusQueueName,
      context: {cfg, github, validator, Builds},
    }),
  },

  worker: {
    requires: ['handlers'],
    setup: async ({handlers}) => handlers.setup(),
  },
}, ['profile', 'process']);

if (!module.parent) {
  load(process.argv[2], {
    process: process.argv[2],
    profile: process.env.NODE_ENV,
  }).catch(err => {
    console.log(err.stack);
    process.exit(1);
  });
}

// Export load for tests
module.exports = load;
