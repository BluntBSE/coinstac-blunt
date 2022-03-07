import React, { useEffect, useState } from 'react';
import { ipcRenderer } from 'electron';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { get } from 'lodash';
import Typography from '@material-ui/core/Typography';
import Divider from '@material-ui/core/Divider';
import { withStyles } from '@material-ui/core/styles';
import { Button, Card, TextField } from '@material-ui/core';
import { useLazyQuery, useMutation } from '@apollo/client';
import ReactJson from 'react-json-view';
import { GET_PIPELINES_QUERY, STOP_RUN_MUTATION } from '../../state/graphql/functions';

const styles = theme => ({
  pageTitle: {
    marginBottom: theme.spacing(2),
  },
});

const stopPipeline = (pipelineId, runId) => () => {
  ipcRenderer.send('stop-pipeline', { pipelineId, runId });
};

const PipelineStates = (
  {
    classes, user, consortia, runs,
  },
  { router }
) => {
  useEffect(() => {
    if (!get(user, 'permissions.roles.admin')) {
      router.push('/');
    }
  }, []);


  const [getPipelines, { data }] = useLazyQuery(GET_PIPELINES_QUERY, { fetchPolicy: 'network-only' });
  const [stopRun, stopRunData] = useMutation(STOP_RUN_MUTATION);

  const pipelinesData = data
    && data.getPipelines
    && data.getPipelines.info
    ? JSON.parse(data.getPipelines.info) : {};

  const { activePipelines } = pipelinesData;


  return (
    <div>
      <Typography variant="h4" className={classes.pageTitle}>
        Pipeline States
      </Typography>
      <Divider />
      <Button onClick={getPipelines} variant="contained">
        Get Pipeline States
      </Button>
      {activePipelines
        && Object.keys(activePipelines).map((pipelineId) => {
          return (
            <Card
              key={pipelineId}
            >
              <Typography variant="h5" className={classes.pageTitle}>
                {pipelineId}
              </Typography>
              <Button
                onClick={() => { stopRun({ variables: { runId: pipelineId } }); }}
              >
                Stop Run
              </Button>
              <ReactJson
                src={activePipelines[pipelineId]}
                theme="monokai"
                displayDataTypes={false}
                displayObjectSize={false}
                enableClipboard={false}
              />
            </Card>
          );
        })
      }
      {/* <ReactJson
        src={pipelinesData}
        theme="monokai"
        displayDataTypes={false}
        displayObjectSize={false}
        enableClipboard={false}
      /> */}
    </div>
  );
};

PipelineStates.contextTypes = {
  router: PropTypes.object.isRequired,
};

PipelineStates.defaultProps = {
  consortia: [],
  runs: [],
};

PipelineStates.propTypes = {
  classes: PropTypes.object.isRequired,
  consortia: PropTypes.array,
  runs: PropTypes.array,
  user: PropTypes.object.isRequired,
};

const mapStateToProps = ({ auth, runs }) => ({
  runs: runs.runs,
  user: auth.user,
});

const connectedComponent = connect(mapStateToProps)(PipelineStates);

export default withStyles(styles, { withTheme: true })(connectedComponent);
