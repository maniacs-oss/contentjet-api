import config from './config';
import * as path from 'path';
import * as Koa from 'koa';
import * as bodyParser from 'koa-bodyparser';
import * as cors from 'kcors';
import * as send from 'koa-send';
import * as Router from 'koa-router';
import {Model, ValidationError as ObjectionValidationError} from 'objection';
Model.knex(require('knex')(config.DATABASE));
import * as jwt from 'jsonwebtoken';
import * as yaml from 'yamljs';

import ProjectViewSet from './viewsets/ProjectViewSet';
import UserViewSet from './viewsets/UserViewSet';
import WebHookViewSet from './viewsets/WebHookViewSet';
import ProjectInviteViewSet from './viewsets/ProjectInviteViewSet';
import MediaViewSet from './viewsets/MediaViewSet';
import MediaTagViewSet from './viewsets/MediaTagViewSet';
import EntryTypeViewSet from './viewsets/EntryTypeViewSet';
import EntryViewSet from './viewsets/EntryViewSet';
import EntryTagViewSet from './viewsets/EntryTagViewSet';

import Entry from './models/Entry';
import EntryTag from './models/EntryTag';
import EntryType from './models/EntryType';
import Media from './models/Media';
import MediaTag from './models/MediaTag';
import Permission from './models/Permission';
import Project from './models/Project';
import ProjectInvite from './models/ProjectInvite';
import ProjectMembership from './models/ProjectMembership';
import Role from './models/Role';
import User from './models/User';
import WebHook from './models/WebHook';

import NotFoundError from './errors/NotFoundError';
import ValidationError from './errors/ValidationError';
import AuthenticationError from './errors/AuthenticationError';

import WebHookMiddleware from './webhooks/middleware';

// Attach it to the viewSetOptions
const viewSetOptions = {
  storage: config.STORAGE_BACKEND
};

// Instantiate root router and attach routes
const router = new Router();
router.use('/user/', new UserViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/', async function (ctx: Koa.Context, next: Function) {
  const project = await Project.getById(ctx.params.projectId);
  if (!project) throw new NotFoundError();
  ctx.state.project = project;
  await next();
});
router.use('/project/', new ProjectViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/web-hook/', new WebHookViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/invite/', new ProjectInviteViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/media/', new MediaViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/media-tag/', new MediaTagViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/entry-type/', new EntryTypeViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/entry-tag/', new EntryTagViewSet(viewSetOptions).routes());
router.use('/project/:projectId(\\d+)/entry/', new EntryViewSet(viewSetOptions).routes());

// Load the OpenAPI spec from disk converting YAML to JSON and dynamically populating
// the servers array with our config.BACKEND_URL.
const spec = yaml.load('spec.yml');
if (!spec.servers) spec.servers = [];
spec.servers.push({url: config.BACKEND_URL});
router.get('/spec', function (ctx: Koa.Context) {
  ctx.set('Cache-Control', 'max-age=604800');
  ctx.body = spec;
});

// robots.txt
router.get('/robots.txt', function (ctx: Koa.Context) {
  ctx.set('Cache-Control', 'max-age=604800');
  ctx.body = 'User-agent: *\nDisallow: /';
});

const app = new Koa();

// Expose sendMail method on context prototype
app.context.sendMail = config.MAIL_BACKEND.sendMail;

app
  .use(cors(config.CORS))
  .use(async function (ctx: Koa.Context, next: Function) {
    try {
      await next();
      // Catch Koa's stadard 404 response and throw our own error
      if (ctx.response.status === 404) throw new NotFoundError();
    } catch (err) {
      if (err instanceof ObjectionValidationError) {
        let e = new ValidationError();
        e.errors = err.data;
        ctx.body = e;
        ctx.status = e.status;
      } else if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
        let e = new AuthenticationError(err.message);
        ctx.body = e;
        ctx.status = e.status;
      } else {
        ctx.status = err.status || err.statusCode || 500;
        ctx.body = err;
      }
      if (config.DEBUG) console.log(err.stack);
    }
  })
  .use(WebHookMiddleware);

if (config.SERVE_MEDIA) {
  app.use(async function (ctx: Koa.Context, next: Function) {
    if (ctx.path.match(/^\/media\/.*$/)) {
      await send(ctx, path.join(config.MEDIA_ROOT, ctx.path.replace('/media/', '')));
    } else {
      await next();
    }
  });
}

app
  .use(bodyParser())
  .use(router.routes())
  .use(router.allowedMethods())
  .use(async function (ctx: Koa.Context) {
    ctx.status = 404;
    ctx.body = {
      message: 'Not found',
      status: 404
    };
  });

export default app;

export const models = {
  Entry,
  EntryTag,
  EntryType,
  Media,
  MediaTag,
  Permission,
  Project,
  ProjectInvite,
  ProjectMembership,
  Role,
  User,
  WebHook
};
