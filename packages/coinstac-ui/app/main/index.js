/**
 * Main process entry point.
 *
 * This script runs boot scripts in order, wiring up Electron's main process and
 * kicking off the render process (UI).
 */

/* eslint-disable no-await-in-loop */

'use strict';

Error.stackTraceLimit = 100;

const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');
const tar = require('tar-fs');
const gunzip = require('gunzip-maybe');

if (process.env.CI) {
  // write out DEBUG:mqttjs* logs to file
  const stdOverride = fs.createWriteStream('./mqtt.log', { flags: 'a' });
  const write = (...args) => {
    stdOverride.write(...args);
  };
  process.stdout.write = write;
  process.stderr.write = write;
}


const {
  compact, keys, pick, omit,
} = require('lodash'); // eslint-disable-line no-unused-vars
const electron = require('electron');
const fsPromises = require('fs').promises;
const path = require('path');
const moment = require('moment');
const Store = require('electron-store');
const ipcFunctions = require('./utils/ipc-functions');
const runPipelineFunctions = require('./utils/run-pipeline-functions');

const { ipcMain } = electron;

const { EXPIRED_TOKEN, BAD_TOKEN } = require('../render/utils/error-codes');

// if no env set prd
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Set up root paths
require('../common/utils/add-root-require-path');

// Parse and handle CLI flags
const parseCLIInput = require('./utils/boot/parse-cli-input');

parseCLIInput();

// Add dev mode specific services
require('./utils/boot/configure-dev-services');

// Load the UI
const { createWindow } = require('./utils/boot/configure-browser-window');

// Set up error handling
const logUnhandledError = require('../common/utils/log-unhandled-error');
const configureCore = require('./utils/boot/configure-core');
const { configureLogger, readInitialLogContents } = require('./utils/boot/configure-logger');
const upsertCoinstacUserDir = require('./utils/boot/upsert-coinstac-user-dir');
const loadConfig = require('../config');
const fileFunctions = require('./services/files');

const { checkForUpdates } = require('./utils/auto-update');

const getAllFilesInDirectory = async (directory) => {
  const dirents = await fs.promises.readdir(directory, { withFileTypes: true });
  const files = dirents.map((dirent) => {
    const res = path.resolve(directory, dirent.name);
    return dirent.isDirectory() ? getAllFilesInDirectory(res) : res;
  });
  return Array.prototype.concat(...files);
};

const exists = async (path) => {
  const result = await fsPromises.stat(path).catch(() => false);

  return Boolean(result);
};

const generateRunProvenance = async (userId, appDirectory, run, consortium) => {
  const clients = keys(run.clients).map(clientId => ({
    id: clientId,
    username: run.clients[clientId],
  }));

  const provenance = {
    ...omit(run, ['clients', 'consortiumId', '__typename']),
    consortium: pick(consortium, ['id', 'name']),
    clients,
  };

  const runProvenanceDirectory = path.join(appDirectory, 'output', userId, provenance.id);

  if (!await exists(runProvenanceDirectory)) {
    await fsPromises.mkdir(runProvenanceDirectory, { recursive: true });
  }

  const provenanceFilePath = path.join(runProvenanceDirectory, 'provenance.json');

  if (!await exists(provenanceFilePath)) {
    await fsPromises.writeFile(provenanceFilePath, JSON.stringify(provenance, null, 2));
  }
};

let initializedCore;
Store.initRenderer();
// Boot up the main process
loadConfig()
  .then(config => Promise.all([
    config,
    configureLogger(config),
  ]))
  .then(([config, logger]) => {
    const unhandler = logUnhandledError(null, logger);
    process.on('uncaughtException', (err) => {
      try {
        unhandler(err);
      } catch (e) {
        console.error('Logging failure:');// eslint-disable-line no-console
        console.error(e);// eslint-disable-line no-console
        console.error('Thrown error on failure:');// eslint-disable-line no-console
        console.error(err);// eslint-disable-line no-console
      }
    });
    process.on('unhandledRejection', (err) => {
      try {
        unhandler(err);
      } catch (e) {
        console.error('Logging failure:');// eslint-disable-line no-console
        console.error(e);// eslint-disable-line no-console
        console.error('Thrown error on failure:');// eslint-disable-line no-console
        console.error(err);// eslint-disable-line no-console
      }
    });

    ipcMain.handle('get-config', () => config.getProperties());

    logger.verbose('main process booted');
    createWindow().then((mainWindow) => {
      if (electron.app.isPackaged || process.env.NODE_ENV === 'production') {
        checkForUpdates(mainWindow, logger);
      }
      mainWindow.webContents.setWindowOpenHandler((url) => {
        electron.shell.openExternal(url);
        return { action: 'deny' };
      });

      logger.on('log-message', (arg) => {
        mainWindow.webContents.send('log-message', arg);
      });

      ipcMain.on('load-initial-log', async () => {
        const fileContents = await readInitialLogContents(config);
        mainWindow.webContents.send('log-message', { data: fileContents });
      });

      ipcMain.on('clean-remote-pipeline', (event, runId) => {
        if (initializedCore) {
          initializedCore.unlinkFiles(runId)
            .catch((err) => {
              logger.error(err);
              mainWindow.webContents.send('main-error', {
                err: {
                  message: err.message,
                  stack: err.stack,
                },
              });
            });
        }
      });

      /**
     * IPC Listener to write logs
     * @param {String} message The message to write out to log
     * @param {String} type The type of log to write out
     */
      ipcMain.on('write-log', (event, { type, message }) => {
        logger[type](`process: render - ${JSON.stringify(message)}`);
      });

      /**
       * IPC Listener to notify token expire
       */
      ipcMain.on(EXPIRED_TOKEN, () => {
        mainWindow.webContents.send(EXPIRED_TOKEN);
      });

      ipcMain.on(BAD_TOKEN, () => {
        logger.error('A bad token was used on a request to the api');

        mainWindow.webContents.send(BAD_TOKEN);
      });

      /**
       * IPC Listener to prepare consortia files
       */
      ipcMain.on('prepare-consortia-files', async (event, { userId, fileTree, appDirectory }) => {
        const userRunDirectory = path.join(appDirectory, 'runs', userId);

        if (await !exists(userRunDirectory)) {
          await fs.promises.mkdir(userRunDirectory, { recursive: true });
        }
        const res = [];

        fileTree.forEach(async (consortium) => {
          const sanitizedName = consortium.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
          const consortiumDirectory = path.join(userRunDirectory, sanitizedName);

          if (await !exists(consortiumDirectory)) {
            await fs.promises.mkdir(consortiumDirectory, { recursive: true });
          }

          consortium.runs.forEach(async (run) => {
            const runDirectory = path.join(
              consortiumDirectory,
              `${run.pipelineName} - ${run.id} - ${moment(run.endDate).format('YYYY-MM-DD')}`
            );

            if (await !exists(runDirectory)) {
              await fs.promises.mkdir(runDirectory, { recursive: true });
            }

            const outputDirectory = path.join(appDirectory, 'output', userId, run.id);

            if (await exists(outputDirectory)) {
              const allFiles = await getAllFilesInDirectory(outputDirectory);

              allFiles.forEach(async (file) => {
                const relativePath = path.relative(outputDirectory, file);
                const symlinkPath = path.join(runDirectory, relativePath);
                const symlinkDirectory = path.dirname(symlinkPath);

                if (await !exists(symlinkDirectory)) {
                  await fs.promises.mkdir(symlinkDirectory, { recursive: true });
                }


                if (await !exists(symlinkPath)) {
                  await fs.promises.symlink(file, symlinkPath);
                }

                const createdSymlinkPath = path
                  .relative(appDirectory, symlinkPath)
                  .replace(`runs${path.sep}${userId}${path.sep}`, '');

                res.push(createdSymlinkPath);
              });
            }
          });
        });

        mainWindow.webContents.send('prepare-consortia-files', res);
      });


      ipcMain.handle('login-init', (event, {
        userId, appDirectory, clientServerURL, token,
      }) => {
        return initializedCore
          ? Promise.resolve()
          : configureCore(
            config,
            logger,
            userId,
            appDirectory,
            config.get('singularityDir'),
            clientServerURL || config.get('clientServerURL'),
            token
          )
            .then((c) => {
              initializedCore = c;
              return upsertCoinstacUserDir(c);
            });
      });

      /**
       * [initializedCore description]
       * @type {[type]}
       */
      ipcMain.handle('logout', () => {
        // TODO: hacky way to not get a mqtt reconnn loop
        // a better way would be to make an actual shutdown fn for pipeline
        return new Promise((resolve) => {
          if (!initializedCore) {
            resolve();
            return;
          }

          initializedCore.pipelineManager.mqttClient.end(true, () => {
            initializedCore = undefined;
            resolve();
          });
        });
      });

      ipcMain.handle('set-client-server-url', (event, url) => new Promise((resolve) => {
        initializedCore.setClientServerURL(url);
        resolve();
      }));

      function startPipelineRun(run, filesArray, consortium, networkVolume, runState) {
        const pipeline = run.pipelineSnapshot;

        const computationImageList = pipeline.steps
          .map(step => step.computations
            .map(comp => comp.computation.dockerImage))
          .reduce((acc, val) => acc.concat(val), []);

        return initializedCore.Manager.pullImagesFromList(computationImageList)
          .then((compStreams) => {
            const streamProms = [];

            compStreams.forEach(({ stream }) => {
              let proxRes;
              let proxRej;

              streamProms.push(new Promise((resolve, reject) => {
                proxRej = reject;
                proxRes = resolve;
              }));
              if (typeof stream.on !== 'function') {
                proxRej(stream.message);
              } else {
                mainWindow.webContents.send('local-pipeline-state-update', {
                  run,
                  data: { controllerState: 'Downloading required docker images' },
                });

                stream.on('data', (data) => {
                  mainWindow.webContents.send('local-pipeline-state-update', {
                    run,
                    data: { controllerState: `Downloading required docker images\n ${data.toString()}` },
                  });
                });

                stream.on('end', () => {
                  proxRes();
                });

                stream.on('error', (err) => {
                  proxRej(err);
                });
              }
            });

            return Promise.all(streamProms);
          })
          .catch((err) => {
            return initializedCore.unlinkFiles(run.id)
              .then(() => {
                mainWindow.webContents.send('local-run-error', {
                  consName: consortium.name,
                  run: Object.assign(
                    run,
                    {
                      error: {
                        message: err.message,
                        stack: err.stack,
                        error: err.error,
                      },
                      endDate: Date.now(),
                    }
                  ),
                });
              });
          })
          .then(() => initializedCore.Manager.pruneImages())
          .then(() => {
            logger.verbose('############ Client starting pipeline');

            const pipelineName = pipeline.name;
            const consortiumName = consortium.name;

            ipcFunctions.sendNotification(
              'Pipeline started',
              `Pipeline ${pipelineName} started on consortia ${consortiumName}`
            );

            return initializedCore.startPipeline(
              null,
              consortium.id,
              pipeline,
              filesArray,
              run.id,
              run.pipelineSteps,
              networkVolume,
              runState
            )
              .then(({ pipeline, result }) => {
                // Listen for local pipeline state updates
                pipeline.stateEmitter.on('update', (data) => {
                  mainWindow.webContents.send('local-pipeline-state-update', { run, data });
                });

                // Listen for results
                return result.then((results) => {
                  logger.verbose('########### Client pipeline done');

                  ipcFunctions.sendNotification(
                    'Pipeline finished',
                    `Pipeline ${pipelineName} finished on consortia ${consortiumName}`
                  );

                  generateRunProvenance(
                    initializedCore.clientId, initializedCore.appDirectory, run, consortium
                  );

                  return initializedCore.unlinkFiles(run.id)
                    .then(() => {
                      if (run.type === 'local') {
                        mainWindow.webContents.send('local-run-complete', {
                          consName: consortium.name,
                          run: Object.assign(run, { results, endDate: Date.now() }),
                        });
                      }
                    });
                })
                  .catch((error) => {
                    logger.verbose('########### Client pipeline error');
                    logger.verbose(error.message);

                    ipcFunctions.sendNotification(
                      'Pipeline stopped',
                      `Pipeline ${pipelineName} stopped on consortia ${consortiumName}`
                    );

                    return initializedCore.unlinkFiles(run.id)
                      .then(() => {
                        mainWindow.webContents.send('local-run-error', {
                          consName: consortium.name,
                          run: Object.assign(
                            run,
                            {
                              error: {
                                message: error.message,
                                stack: error.stack,
                                error: error.error,
                                input: error.input,
                              },
                              endDate: Date.now(),
                            }
                          ),
                        });
                      });
                  });
              })
              .catch((error) => {
                logger.verbose('############ Client pipeline error');
                logger.verbose(error);

                mainWindow.webContents.send('local-run-error', {
                  consName: consortium.name,
                  run: Object.assign(
                    run,
                    {
                      error: {
                        message: error.message,
                        stack: error.stack,
                        error: error.error,
                      },
                      endDate: Date.now(),
                    }
                  ),
                });
              });
          });
      }

      async function startPipeline(consortium, dataMappings, pipelineRun, networkVolume, runState) {
        try {
          const { filesArray, steps } = runPipelineFunctions.parsePipelineInput(
            pipelineRun.pipelineSnapshot, dataMappings
          );
          const run = {
            ...pipelineRun,
            pipelineSnapshot: {
              ...pipelineRun.pipelineSnapshot,
              steps,
            },
          };

          mainWindow.webContents.send('save-local-run', { run: pipelineRun, steps });

          await startPipelineRun(run, filesArray, consortium, networkVolume, runState);
        } catch (error) {
          mainWindow.webContents.send('notify-warning', error.message);
        }
      }

      /**
     * IPC Listener to start pipeline
     * @param {Object} consortium Consortium starting the pipeline
     * @param {Object} dataMappings Mapping of pipeline variables into data file columns
     * @param {Object} pipelineRun Current run details
     * @return {Promise<String>} Status message
     */
      ipcMain.on('start-pipeline', (event, {
        consortium, dataMappings, pipelineRun, networkVolume, runState,
      }) => {
        // This is a way to avoid multiple instances of COINSTAC
        // running on the same machine to start
        // the pipeline runs at the same time. We start the pipeline runs with random delays
        // between 0 and 3000ms.
        const delayAmount = Math.floor(Math.random() * 3000);

        setTimeout(() => {
          startPipeline(consortium, dataMappings, pipelineRun, networkVolume, runState);
        }, delayAmount);
      });

      /**
       * IPC Listener to stop pipeline
       * @param {String} pipelineId The id of the pipeline currently running
       * @param {String} runId The id of the pipeline run
       * @return {Promise<String>} Status message
       */
      ipcMain.on('stop-pipeline', (event, { pipelineId, runId }) => {
        try {
          return initializedCore.requestPipelineStop(pipelineId, runId);
        } catch (err) {
          logger.error(err);
          mainWindow.webContents.send('main-error', {
            err: {
              message: err.message,
              stack: err.stack,
            },
          });
        }
      });

      ipcMain.handle('suspend-pipeline', async (e, { runId }) => {
        try {
          return initializedCore.pipelineManager.suspendPipeline(runId);
        } catch (err) {
          logger.error(err);
          mainWindow.webContents.send('main-error', {
            err: {
              message: err.message,
              stack: err.stack,
            },
          });
        }
      });

      /**
    * IPC listener to return a list of all local Docker images
    * @return {Promise<String[]>} An array of all local Docker image names
    */
      ipcMain.handle('get-all-images', () => {
        return initializedCore.Manager.getImages()
          .then((data) => {
            return data;
          })
          .catch((err) => {
            logger.error(err);
            mainWindow.webContents.send('docker-error', {
              err: {
                message: err.message,
                stack: err.stack,
              },
            });
          });
      });


      /**
    * IPC listener to return status of Docker
    * @return {Promise<boolean[]>} Docker running?
    */
      ipcMain.handle('get-status', () => {
        return initializedCore.Manager.getStatus()
          .then((result) => {
            return result;
          })
          .catch((err) => {
            logger.error(err);
            mainWindow.webContents.send('docker-error', {
              err: {
                message: err.message,
                stack: err.stack,
              },
            });
          });
      });

      /**
    * IPC Listener to download a list of computations
    * @param {Object} params
    * @param {String[]} params.computations An array of docker image names
    * @param {String} params.consortiumId ID of the consortium, if relevant,
    *  associated with the computations being retrieved
    * @return {Promise}
    */
      ipcMain.handle('download-comps', (event, params) => { // eslint-disable-line no-unused-vars
        return initializedCore.Manager
          .pullImages(params.computations)
          .then((compStreams) => {
            let streamsComplete = 0;

            compStreams.forEach(({ compId, compName, stream }) => {
              if (typeof stream.on !== 'function') {
                const output = [{
                  message: stream.message, status: 'error', statusCode: stream.statusCode, isErr: true,
                }];
                mainWindow.webContents.send('docker-out', { output, compId, compName });
              } else {
                stream.on('data', (data) => {
                  let output = compact(data.toString().split('\r\n'));
                  output = output.map(JSON.parse);

                  mainWindow.webContents.send('docker-out', { output, compId, compName });
                });

                stream.on('end', () => {
                  mainWindow.webContents.send('docker-out',
                    {
                      output: [{ id: `${compId}-complete`, status: 'complete' }],
                      compId,
                      compName,
                    });

                  streamsComplete += 1;

                  if (params.consortiumId && streamsComplete === params.computations.length) {
                    mainWindow.webContents
                      .send('docker-pull-complete', params.consortiumId);
                  }
                });

                stream.on('error', (err) => {
                  const output = [{
                    message: err.json, status: 'error', statusCode: err.statusCode, isErr: true,
                  }];
                  mainWindow.webContents.send('docker-out', { output, compId, compName });
                });
              }
            });
          })
          .catch((err) => {
            const output = [{
              message: err.json, status: 'error', statusCode: err.statusCode, isErr: true,
            }];
            mainWindow.webContents.send('docker-out', { output });
          });
      });

      /**
     * IPC Listener to open a dialog in Electron
     * @param {String} org How the files being retrieved are organized
     * @return {String[]} List of file paths being retrieved
    */
      ipcMain.handle('open-dialog', (event, { org, filters, properties }) => {
        let dialogFilters = [];
        let dialogProperties;
        let postDialogFunc;

        if (org === 'jsonschema') {
          dialogFilters = [{
            name: 'JSON Schema',
            extensions: ['json'],
          }];
          dialogProperties = ['openFile'];
          postDialogFunc = ipcFunctions.returnFileAsJSON;
        } else if (org === 'directory') {
          dialogProperties = ['openDirectory'];
          postDialogFunc = ipcFunctions.manualDirectorySelection;
        } else {
          dialogFilters = filters || [];
          dialogProperties = properties;
          postDialogFunc = ipcFunctions.manualDirectorySelection;
        }
        dialogFilters.push({ name: 'All Files', extensions: ['*'] });

        return fileFunctions.showDialog(
          mainWindow,
          dialogFilters,
          dialogProperties
        )
          .then(({ filePaths }) => postDialogFunc(filePaths, initializedCore));
      });
      /**
     * IPC Listener to remove a Docker image
     * @param {String} imgId ID of the image to remove
     */
      ipcMain.handle('remove-image', (event, { compId, imgId, imgName }) => {
        return initializedCore.Manager.removeImage(imgId)
          .catch((err) => {
            const output = [{
              message: err.message, status: 'error', statusCode: err.statusCode, isErr: true,
            }];
            mainWindow.webContents.send('docker-out', { output, compId, compName: imgName });
          });
      });

      ipcMain.handle('download-run-assets', async (event,
        {
          runId,
          authToken,
          clientId,
          apiServerUrl,
        }) => {
        // get the base directory to construct the full path from
        const { appDirectory } = initializedCore;
        const runOutputDirectory = path.join(appDirectory, 'output', clientId, runId);

        // make the outputDirectory if it doesn't exist
        async function pathExists(path) {
          let exists = false;
          try {
            await fs.promises.access(path);
            exists = true;
          } catch {
            exists = false;
          }
          return exists;
        }
        if (!await pathExists(runOutputDirectory)) {
          await fs.promises.mkdir(runOutputDirectory, { recursive: true });
        }

        // create the file at the end path and start writing to it
        const outputFilePath = path.join(runOutputDirectory, `${runId}.tar.gz`);
        const writer = fs.createWriteStream(outputFilePath);

        const formData = new FormData();
        formData.append('runId', runId);
        // axios post to the url
        try {
          const response = await axios.post(
            `${apiServerUrl}/downloadFiles`,
            formData,
            {
              headers: {
                Authorization: `Bearer ${authToken}`,
                ...formData.getHeaders(),

              },
              responseType: 'stream',
            }
          );

          // stream to the correct output directory
          await new Promise((resolve, reject) => {
            response.data.pipe(writer);
            let error = null;
            writer.on('error', (err) => {
              error = err;
              writer.close();
              reject(err);
            });
            writer.on('close', () => {
              if (!error) {
                resolve(true);
              }
            });
          });

          // extract the tar
          const readStream = fs.createReadStream(outputFilePath);
          const writeStream = tar.extract(runOutputDirectory);
          readStream.pipe(gunzip()).pipe(writeStream);

          await new Promise((resolve, reject) => {
            writeStream.on('finish', () => {
              logger.verbose('writeStream finished');
              resolve();
            });
            readStream.on('error',
              (e) => {
                reject(e);
              });
          });
        } catch (e) {
          await fs.promises.unlink(outputFilePath);
          throw e;
        }
        // delete the tar.gz
        await fs.promises.unlink(outputFilePath);

        return 'download complete';
      });

      ipcMain.handle('filesExist', async (event, { directoryPath }) => {
        try {
          // check to see if directory exists
          const fileNames = await fs.promises.readdir(directoryPath);
          // check to see if directory is empty
          if (fileNames.length > 0) {
            return true;
          }
          return false;
        } catch (e) {
          return false;
        }
      });
    });
  });
