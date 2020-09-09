import axios from 'axios';
import ipcPromise from 'ipc-promise';
import { remote, ipcRenderer } from 'electron';
import { get } from 'lodash';
import { LOCATION_CHANGE } from 'react-router-redux';
import { applyAsyncLoading } from './loading';
import { notifySuccess, notifyError } from './notifyAndLog';

const apiServer = remote.getGlobal('config').get('apiServer');
const API_URL = `${apiServer.protocol}//${apiServer.hostname}${apiServer.port ? `:${apiServer.port}` : ''}${apiServer.pathname}`;

export const API_TOKEN_KEY = `id_token_${remote.getCurrentWindow().id}`;

const getErrorDetail = error => ({
  message: get(error, 'response.data.message'),
  statusCode: get(error, 'response.status'),
});

const INITIAL_STATE = {
  user: {
    id: '',
    username: '',
    permissions: {},
    email: '',
    institution: '',
    photo: '',
    consortiaStatuses: {},
  },
  appDirectory: localStorage.getItem('appDirectory') || remote.getGlobal('config').get('coinstacHome'),
  clientServerURL: localStorage.getItem('clientServerURL') || '',
  isApiVersionCompatible: true,
  locationStacks: [],
  error: null,
};

const EXCLUDE_PATHS = ['login', 'signup'];

// Actions
const SET_USER = 'SET_USER';
const CLEAR_USER = 'CLEAR_USER';
const SET_ERROR = 'SET_ERROR';
const CLEAR_ERROR = 'CLEAR_ERROR';
const UPDATE_USER_CONSORTIA_STATUSES = 'UPDATE_USER_CONSORTIA_STATUSES';
const UPDATE_USER_PERMS = 'UPDATE_USER_PERMS';
const SET_APP_DIRECTORY = 'SET_APP_DIRECTORY';
const SET_CLIENT_SERVER_URL = 'SET_CLIENT_SERVER_URL';
const SET_API_VERSION_CHECK = 'SET_API_VERSION_CHECK';

// Action Creators
export const setUser = user => ({ type: SET_USER, payload: user });
export const clearUser = () => ({ type: CLEAR_USER });
export const setError = error => ({ type: SET_ERROR, payload: error });
export const clearError = () => ({ type: CLEAR_ERROR });
export const updateUserConsortiaStatuses = statuses => ({
  type: UPDATE_USER_CONSORTIA_STATUSES,
  payload: statuses,
});
export const updateUserPerms = perms => ({ type: UPDATE_USER_PERMS, payload: perms });
export const setAppDirectory = appDirectory => ({ type: SET_APP_DIRECTORY, payload: appDirectory });
export const setClientServerURL = clientServerURL => ({
  type: SET_CLIENT_SERVER_URL,
  payload: clientServerURL,
});
export const setApiVersionCheck = isApiVersionCompatible => ({
  type: SET_API_VERSION_CHECK,
  payload: isApiVersionCompatible,
});

// Helpers
const initCoreAndSetToken = async (reqUser, data, appDirectory, clientServerURL, dispatch) => {
  if (appDirectory) {
    localStorage.setItem('appDirectory', appDirectory);
  }

  if (clientServerURL) {
    localStorage.setItem('clientServerURL', clientServerURL);
  }

  await ipcPromise.send('login-init', {
    userId: reqUser.userid, appDirectory, clientServerURL, token: data.id_token,
  });

  const user = { ...data.user, label: reqUser.username };

  remote.getCurrentWindow().webContents.send('login-success', data.user.id);

  return new Promise((resolve) => {
    ipcRenderer.on('app-init-finished', () => {
      const tokenData = {
        token: data.id_token,
        userId: user.id,
      };

      if (reqUser.saveLogin) {
        localStorage.setItem(API_TOKEN_KEY, JSON.stringify(tokenData));
      } else {
        sessionStorage.setItem(API_TOKEN_KEY, JSON.stringify(tokenData));
      }

      dispatch(setUser(user));

      resolve();
    });
  });
};

export const logout = applyAsyncLoading(() => (dispatch) => {
  localStorage.removeItem(API_TOKEN_KEY);
  sessionStorage.removeItem(API_TOKEN_KEY);
  return ipcPromise.send('logout')
    .then(() => {
      dispatch(clearUser());
    });
});

export const setClientCoreUrlAsync = applyAsyncLoading(url => (dispatch) => {
  localStorage.setItem('clientServerURL', url);
  return ipcPromise.send('set-client-server-url', url)
    .then(() => {
      dispatch(setClientServerURL(url));
    });
});

export const autoLogin = applyAsyncLoading(() => (dispatch, getState) => {
  let token = localStorage.getItem(API_TOKEN_KEY);
  let saveLogin = true;

  if (!token || token === 'null' || token === 'undefined') {
    token = sessionStorage.getItem(API_TOKEN_KEY);
    saveLogin = false;
  }

  if (!token || token === 'null' || token === 'undefined') {
    return;
  }

  token = JSON.parse(token);

  return axios.post(
    `${API_URL}/authenticateByToken`,
    null,
    { headers: { Authorization: `Bearer ${token.token}` } }
  )
    // TODO: GET RID OF CORE INIT
    .then(({ data }) => {
      const { auth: { appDirectory, clientServerURL } } = getState();
      return initCoreAndSetToken(
        { id: data.user.id, saveLogin, password: 'password' },
        data,
        appDirectory,
        clientServerURL,
        dispatch
      );
    })
    .catch((err) => {
      console.error(err); // eslint-disable-line no-console
      if (err.response) {
        dispatch(logout());
        const { statusCode, message } = getErrorDetail(err);
        if (statusCode === 401) {
          dispatch(setError(message || 'Please Login Again'));
        } else {
          dispatch(setError('An unexpected error has occurred'));
        }
      } else {
        dispatch(setError('Coinstac services not available'));
      }
    });
});

export const checkApiVersion = applyAsyncLoading(() => dispatch => axios.get(`${API_URL}/version`)
  .then(({ data }) => {
    const versionsMatch = remote.process.env.NODE_ENV !== 'production' || data === remote.app.getVersion();
    dispatch(setApiVersionCheck(versionsMatch));
  })
  .catch(() => {
    dispatch(setError('An unexpected error has occurred'));
  }));

export const login = applyAsyncLoading(({ username, password, saveLogin }) => (dispatch, getState) => axios.post(`${API_URL}/authenticate`, { username, password })
  .then(({ data }) => {
    const { auth: { appDirectory, clientServerURL } } = getState();
    return initCoreAndSetToken(
      { username, password, saveLogin }, data, appDirectory, clientServerURL, dispatch
    );
  })
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    if (err.response) {
      const { statusCode } = getErrorDetail(err);

      if (statusCode === 401) {
        dispatch(setError('Username and/or Password Incorrect'));
      } else {
        dispatch(setError('An unexpected error has occurred'));
      }
    } else {
      dispatch(setError('Coinstac services not available'));
    }
  }));

export const signUp = applyAsyncLoading(user => (dispatch, getState) => axios.post(`${API_URL}/createAccount`, user)
  .then(({ data }) => {
    const { auth: { appDirectory, clientServerURL } } = getState();
    return initCoreAndSetToken(user, data, appDirectory, clientServerURL, dispatch);
  })
  .catch((err) => {
    const { statusCode, message } = getErrorDetail(err);
    if (statusCode === 400) {
      dispatch(setError(message));
    }
  }));

export const update = applyAsyncLoading(user => dispatch => axios.post(`${API_URL}/updateAccount`, user)
  .then(({ data }) => {
    const userNew = {
      ...data.user,
      username: user.username,
      photo: user.photo,
      hotoID: user.photoID,
      name: user.name,
    };
    dispatch(setUser(userNew));
  })
  .catch((err) => {
    const { statusCode, message } = getErrorDetail(err);
    if (statusCode === 400) {
      dispatch(setError(message));
    }
  }));

export const sendPasswordResetEmail = applyAsyncLoading(payload => dispatch => axios.post(`${API_URL}/sendPasswordResetEmail`, payload)
  .then(() => {
    dispatch(notifySuccess('Sent password reset email successfully'));
  })
  .catch((err) => {
    const { statusCode, message } = getErrorDetail(err);
    dispatch(notifyError(statusCode === 400 ? message : 'Failed to send password reset email'));
    throw err;
  }));

export const resetPassword = applyAsyncLoading(payload => dispatch => axios.post(`${API_URL}/resetPassword`, payload)
  .then(() => {
    dispatch(notifySuccess('Reset password successfully'));
  })
  .catch((err) => {
    const { statusCode, message } = getErrorDetail(err);
    dispatch(notifyError(statusCode === 400 ? message : 'Provided password reset token is not valid. It could be expired'));
  }));

export default function reducer(state = INITIAL_STATE, { type, payload }) {
  const { locationStacks } = state;
  const { pathname } = payload || {};

  switch (type) {
    case SET_USER:
      return { ...state, user: payload };
    case CLEAR_USER:
      return { ...state, user: { ...INITIAL_STATE.user } };
    case SET_ERROR:
      return { ...state, error: payload };
    case CLEAR_ERROR:
      return { ...state, error: null };
    case UPDATE_USER_CONSORTIA_STATUSES:
      return { ...state, user: { ...state.user, consortiaStatuses: payload } };
    case UPDATE_USER_PERMS:
      return { ...state, user: { ...state.user, permissions: payload } };
    case SET_APP_DIRECTORY:
      localStorage.setItem('appDirectory', payload);
      return { ...state, appDirectory: payload };
    case SET_CLIENT_SERVER_URL:
      localStorage.setItem('clientServerURL', payload);
      return { ...state, clientServerURL: payload };
    case SET_API_VERSION_CHECK:
      return { ...state, isApiVersionCompatible: payload };
    case LOCATION_CHANGE:
      if (EXCLUDE_PATHS.indexOf(pathname) !== -1) {
        return state;
      }

      if (pathname === locationStacks[locationStacks.length - 1]) {
        return state;
      }

      if (locationStacks.length > 1
        && locationStacks[locationStacks.length - 2] === pathname) {
        locationStacks.pop();

        return {
          ...state,
          locationStacks,
        };
      }

      return {
        ...state,
        locationStacks: [...locationStacks, pathname],
      };
    default:
      return state;
  }
}
