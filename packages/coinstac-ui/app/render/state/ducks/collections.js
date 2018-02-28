import { isEqual } from 'lodash';
import { applyAsyncLoading } from './loading';
import localDB from '../local-db';
import testData from '../../../../test/data/test-collection.json';

// Actions
const DELETE_ASSOCIATED_CONSORTIA = 'DELETE_ASSOCIATED_CONSORTIA';
const DELETE_COLLECTION = 'DELETE_COLLECTION';
const GET_COLLECTION_FILES = 'GET_COLLECTION_FILES';
const INIT_TEST_COLLECTION = 'INIT_TEST_COLLECTION';
const SAVE_ASSOCIATED_CONSORTIA = 'SAVE_ASSOCIATED_CONSORTIA';
const SAVE_COLLECTION = 'SAVE_COLLECTION';
const GET_ASSOCIATED_CONSORTIA = 'GET_ASSOCIATED_CONSORTIA';
const REMOVE_COLLECTIONS_FROM_CONS = 'REMOVE_COLLECTIONS_FROM_CONS';
const SET_COLLECTIONS = 'GET_ALL_COLLECTIONS';

function iteratePipelineSteps(consortium, filesByGroup) {
  let mappingIncomplete = false;
  const collections = [];
  const steps = [];

  /* Get step covariates and compare against local file mapping to ensure mapping is complete
      Add local files groups to array in order to grab files to pass to pipeline */
  for (let sIndex = 0; sIndex < consortium.pipelineSteps.length; sIndex += 1) {
    const step = consortium.pipelineSteps[sIndex];
    const inputMap = { ...step.inputMap };

    const inputKeys = Object.keys(inputMap);

    for (let keyIndex = 0; keyIndex < inputKeys.length; keyIndex += 1) {
      const key = inputKeys[keyIndex];
      if ('ownerMappings' in step.inputMap[key]) {
        const keyArray = [[], [], []]; // [[values], [labels], [type (if present)]]

        for (let mappingIndex = 0;
            mappingIndex < step.inputMap[key].ownerMappings.length;
            mappingIndex += 1) {
          const mappingObj = step.inputMap[key].ownerMappings[mappingIndex];
          if (mappingObj.source === 'file'
              && consortium.stepIO[sIndex] && consortium.stepIO[sIndex][key][mappingIndex]
              && consortium.stepIO[sIndex][key][mappingIndex].collectionId) {
            const { groupId, collectionId } = consortium.stepIO[sIndex][key][mappingIndex];
            collections.push({ groupId, collectionId });

            // This changes by how the parser is reading in files - concat or push
            if (filesByGroup) {
              keyArray[0].push(filesByGroup[consortium.stepIO[sIndex][key][mappingIndex].groupId]);
              keyArray[1].push(consortium.stepIO[sIndex][key][mappingIndex].column);

              if ('type' in mappingObj) {
                keyArray[2].push(mappingObj.type);
              }
            }
          } else if (mappingObj.source === 'file'
              && (!consortium.stepIO[sIndex] || !consortium.stepIO[sIndex][key][mappingIndex]
              || !consortium.stepIO[sIndex][key][mappingIndex].collectionId)) {
            mappingIncomplete = true;
            break;
          } else if (filesByGroup && mappingObj.type === 'FreeSurfer') {
            keyArray[0].push(filesByGroup[consortium.stepIO[sIndex][key][mappingIndex].groupId]);
            keyArray[1].push(mappingObj.value);
            keyArray[2].push(mappingObj.type);
          } else if (filesByGroup) {
            // TODO: Handle keys fromCache if need be
          }
        }
        inputMap[key] = { value: keyArray };
      }

      if (mappingIncomplete) {
        break;
      }
    }

    if (mappingIncomplete) {
      break;
    }

    steps.push({ ...step, inputMap });
  }


  if (mappingIncomplete) {
    return {
      error: `Mapping incomplete for new run from ${consortium.name}. Please complete variable mapping before continuing.`,
    };
  }

  return { collections, steps };
}

// Action Creators
export const deleteAssociatedConsortia = applyAsyncLoading(consId =>
  dispatch =>
    localDB.associatedConsortia
      .delete(consId)
      .then(() => {
        dispatch(({
          type: DELETE_ASSOCIATED_CONSORTIA,
          payload: consId,
        }));
      })
  );

export const deleteCollection = applyAsyncLoading(collectionId =>
  dispatch =>
    localDB.collections
      .delete(collectionId)
      .then(() => {
        dispatch(({
          type: DELETE_COLLECTION,
          payload: collectionId,
        }));
      })
  );

export const getAllCollections = applyAsyncLoading(() =>
  dispatch =>
    localDB.collections
      .toArray()
      .then((collections) => {
        dispatch(({
          type: SET_COLLECTIONS,
          payload: collections,
        }));
      })
);

export const getCollectionFiles = applyAsyncLoading((consortiumId, consortiumName) =>
  (dispatch) => {
    return localDB.associatedConsortia.get(consortiumId)
    .then((consortium) => {
      // Should never be thrown. Associated Consortia should always exist for cons user is member of
      if (!consortium) {
        const error = {
          error: `No associated consortia in local db. Please visit Collections and map variables for ${consortiumName}.`,
        };
        dispatch(({
          type: GET_COLLECTION_FILES,
          payload: error,
        }));
        return error;
      }

      let collections = { collections: [] };
      if (consortium.pipelineSteps) {
        collections = iteratePipelineSteps(consortium);
      }

      if ('error' in collections) {
        localDB.associatedConsortia.update(consortium.id, { isMapped: false })
        .then(() => {
          dispatch(({
            type: GET_COLLECTION_FILES,
            payload: collections,
          }));
          return collections;
        });
      }

      localDB.associatedConsortia.update(consortium.id, { isMapped: true });
      if (collections.collections.length === 0) {
        return { allFiles: collections.collections };
      }

      return localDB.collections
        .filter(collection =>
          collections.collections.findIndex(c => c.collectionId === collection.id) > -1
        )
        .toArray()
        .then((localDBCols) => {
          let allFiles = [];
          const filesByGroup = {};

          localDBCols.forEach((coll) => {
            Object.values(coll.fileGroups).forEach((group) => {
              allFiles = allFiles.concat(coll.fileGroups[group.id].files);

              if ('metaFile' in group) {
                filesByGroup[group.id] = coll.fileGroups[group.id].metaFile;
              } else {
                filesByGroup[group.id] = coll.fileGroups[group.id].files;
              }
            });
          });

          // TODO: Reconsider how to get updated steps
          const { steps } = iteratePipelineSteps(consortium, filesByGroup);

          dispatch(({
            type: GET_COLLECTION_FILES,
            payload: { allFiles, steps },
          }));
          return { allFiles, steps };
        });
    });
  }
);

export const getAllAssociatedConsortia = applyAsyncLoading(() =>
  dispatch =>
    localDB.associatedConsortia
      .toArray()
      .then((consortia) => {
        dispatch(({
          type: GET_ASSOCIATED_CONSORTIA,
          payload: consortia,
        }));
      })
);

export const getAssociatedConsortia = applyAsyncLoading(consortiaIds =>
  dispatch =>
    localDB.associatedConsortia
      .filter(cons => consortiaIds.indexOf(cons.id) > -1)
      .toArray()
      .then((consortia) => {
        dispatch(({
          type: GET_ASSOCIATED_CONSORTIA,
          payload: consortia,
        }));
      })
);

export const initTestData = (() =>
  dispatch =>
    localDB.associatedConsortia.clear()
    .then(() => localDB.collections.put(testData))
    .then(() => localDB.associatedConsortia.put({ id: 'test-cons-2', activePipelineId: 'test-pipeline-decentralized', isMapped: false }))
    .then(() => localDB.associatedConsortia.put({ id: 'test-cons-1', activePipelineId: 'nada' }))
    .then(() => {
      dispatch(({
        type: INIT_TEST_COLLECTION,
        payload: null,
      }));
    })
);

export const isAssocConsortiumMapped = applyAsyncLoading(consId =>
  () =>
    localDB.associatedConsortia.get(consId)
    .then(cons => cons.isMapped)
);

export const removeCollectionsFromAssociatedConsortia = applyAsyncLoading((consId, deleteCons) =>
  dispatch =>
    localDB.associatedConsortia.get(consId)
      .then((consortium) => {
        if (!consortium || !consortium.stepIO) {
          return { consortium, collectionIds: [] };
        }

        const collectionIds = [];

        consortium.stepIO.forEach((step) => {
          Object.values(step).forEach((val) => {
            val.forEach((obj) => { collectionIds.push(obj.collectionId); });
          });
        });

        return { consortium, collectionIds };
      })
      .then(({ consortium, collectionIds }) => {
        if (collectionIds.length === 0) {
          return;
        }

        return Promise.all([
          localDB.collections
            .filter(col => collectionIds.indexOf(col.id) > -1)
            .modify((col) => {
              const index = col.associatedConsortia.indexOf(consId);
              col.associatedConsortia.splice(index, 1);
            }),
          deleteCons ? localDB.associatedConsortia.delete(consId)
            : localDB.associatedConsortia.update(consortium.id, {
              activePipelineId: null, isMapped: false, stepIO: null,
            }),
        ]);
      })
      .then(() =>
        Promise.all([
          localDB.collections.toArray(),
          localDB.associatedConsortia.toArray(),
        ])
      )
      .then(([collections, associatedConsortia]) => {
        const payload = { associatedConsortia, collections, consId };
        if (deleteCons) {
          payload.deleteCons = true;
        }

        dispatch(({
          type: REMOVE_COLLECTIONS_FROM_CONS,
          payload,
        }));
      })
  );

export const saveCollection = applyAsyncLoading(collection =>
  dispatch =>
    localDB.collections.put(collection)
      .then(() => {
        dispatch(({
          type: SAVE_COLLECTION,
          payload: collection,
        }));
      })
);

export const saveAssociatedConsortia = applyAsyncLoading(cons =>
  (dispatch) => {
    getCollectionFiles(cons.id);

    return localDB.associatedConsortia.put(cons)
      .then(() => {
        dispatch(({
          type: SAVE_ASSOCIATED_CONSORTIA,
          payload: cons,
        }));
      });
  }
);

export const syncRemoteLocalConsortia = applyAsyncLoading(remoteCons =>
  () =>
    localDB.associatedConsortia.get(remoteCons.id)
      .then((localCons) => {
        if (localCons
          && (localCons.activePipelineId !== remoteCons.activePipelineId)) {
          removeCollectionsFromAssociatedConsortia(remoteCons.id, false);
          getCollectionFiles(localCons.id, localCons.name);
        }
      })
);

export const syncRemoteLocalPipelines = applyAsyncLoading(remotePipeline =>
  () =>
    localDB.associatedConsortia.where('activePipelineId').equals(remotePipeline.id).toArray()
      .then((localConsortia) => {
        if (localConsortia) {
          localConsortia.forEach((localCons) => {
            if (!isEqual(localCons.pipelineSteps, remotePipeline.steps)) {
              removeCollectionsFromAssociatedConsortia(localCons.id, false);
              getCollectionFiles(localCons.id, localCons.name);
            }
          });
        }
      })
);

const INITIAL_STATE = {
  associatedConsortia: [],
  collections: [],
  error: '',
  runFiles: [],
  runSteps: [],
};

export default function reducer(state = INITIAL_STATE, action) {
  switch (action.type) {
    case DELETE_ASSOCIATED_CONSORTIA: {
      const newCons = [...state.associatedConsortia];
      const index = state.associatedConsortia.findIndex(cons => cons.id === action.payload);
      newCons.splice(index, 1);

      return { ...state, associatedConsortia: newCons };
    }
    case DELETE_COLLECTION: {
      const newCollections = [...state.collections];
      const index = state.collections.findIndex(col => col.id === action.payload);
      newCollections.splice(index, 1);

      return { ...state, collections: newCollections };
    }
    case GET_COLLECTION_FILES:
      if ('error' in action.payload) {
        return {
          ...state,
          error: action.payload.error,
        };
      }

      return {
        ...state,
        runFiles: [...action.payload.allFiles],
        runSteps: [...action.payload.steps],
      };
    case SAVE_ASSOCIATED_CONSORTIA: {
      const newCons = [...state.associatedConsortia];
      const index = state.associatedConsortia.findIndex(cons => cons.id === action.payload.id);

      if (index === -1) {
        newCons.push(action.payload);
      } else {
        newCons.splice(index, 1, action.payload);
      }

      return { ...state, associatedConsortia: newCons };
    }
    case REMOVE_COLLECTIONS_FROM_CONS: {
      const newCons = [...action.payload.associatedConsortia];
      const index = newCons.findIndex(cons => cons.id === action.payload.consId);
      if (action.payload.deleteCons) {
        newCons.splice(index, 1);
      }

      return { ...state, collections: action.payload.collections, associatedConsortia: newCons };
    }
    case SAVE_COLLECTION: {
      const newCollections = [...state.collections];
      const index = state.collections.findIndex(col => col.id === action.payload.id);

      if (index === -1) {
        newCollections.push(action.payload);
      } else {
        newCollections.splice(index, 1, action.payload);
      }

      return { ...state, collections: newCollections };
    }
    case SET_COLLECTIONS:
      return { ...state, collections: action.payload };
    case GET_ASSOCIATED_CONSORTIA:
      return { ...state, associatedConsortia: action.payload };
    case INIT_TEST_COLLECTION:
    default:
      return state;
  }
}
