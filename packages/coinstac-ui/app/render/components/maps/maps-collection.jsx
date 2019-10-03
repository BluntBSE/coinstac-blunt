import React, { Component } from 'react';
import ReactDOM from 'react-dom';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import Paper from '@material-ui/core/Paper';
import Button from '@material-ui/core/Button';
import Divider from '@material-ui/core/Divider';
import Typography from '@material-ui/core/Typography';
import { withStyles } from '@material-ui/core/styles';
import FileCopyIcon from '@material-ui/icons/FileCopy';
import DeleteIcon from '@material-ui/icons/Delete';
import ipcPromise from 'ipc-promise';
import PropTypes from 'prop-types';
import shortid from 'shortid';
import { unmapAssociatedConsortia } from '../../state/ducks/collections';
import bitap from 'bitap';

const styles = theme => ({
  addFileGroupButton: {
    marginTop: theme.spacing.unit,
    marginBottom: theme.spacing.unit,
  },
  removeFileGroupButton: {
    marginTop: theme.spacing.unit,
    marginBottom: theme.spacing.unit,
  },
  rootPaper: {
    ...theme.mixins.gutters(),
    paddingTop: theme.spacing.unit * 2,
    paddingBottom: theme.spacing.unit * 2,
    marginTop: theme.spacing.unit * 2,
    height: '100%',
  },
  fileErrorPaper: {
    ...theme.mixins.gutters(),
    paddingTop: theme.spacing.unit * 2,
    paddingBottom: theme.spacing.unit * 2,
    marginBottom: theme.spacing.unit * 2,
    backgroundColor: '#fef7e4',
    textAlign: 'center',
  },
  fileErrorMessage: {
    color: '#ab8e6b',
  },
  fileList: {
    backgroundColor: '#efefef',
    padding: '1rem',
    borderRadius: '0.25rem'
  },
  fileListItem: {
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    margin: '0.25rem'
  },
  actionsContainer: {
    marginTop: theme.spacing.unit * 2,
  },
});

class MapsCollection extends Component {

  constructor(props) {
    super(props);

    this.state = {
      autoMap: false,
      contChildren: -1,
      filesError: null,
      newFile: {
        open: false,
        org: 'metafile',
      },
      showFiles: {},
      source: {},
      finishedAutoMapping: false,
    };

    this.addFileGroup = this.addFileGroup.bind(this);
    this.addFolderGroup = this.addFolderGroup.bind(this);
    this.removeFileGroup = this.removeFileGroup.bind(this);
    this.updateNewFileOrg = this.updateNewFileOrg.bind(this);
    this.updateMapsStep = this.updateMapsStep.bind(this);
    this.setStepIO = this.setStepIO.bind(this);
  }

  componentDidUpdate(prevProps,prevState) {
    if(this.refs.Container){
      let children = 0;
      let Container = ReactDOM.findDOMNode(this.refs.Container);
      if(this.state.autoMap){ //this is a hacky hack to get button change to work on drag and drop mapping :(
        children = Container.children.length - 1;
      }else{
        children = Container.children.length;
      }
      if(prevState.contChildren !== children){
        this.setState(prevState => ({
          contChildren: children
        }));
      }
      this.props.getContainers(Container);
    }
  }

  addFileGroup() {
    ipcPromise.send('open-dialog', 'metafile')
    .then((obj) => {

      let newFiles;

      const fileGroupId = shortid.generate();

      if (obj.error) {
        this.setState({ filesError: obj.error });
      } else {
        const name = `Group ${Object.keys(this.props.collection.fileGroups).length + 1} (${obj.extension.toUpperCase()})`;

        this.props.setRowArray(obj.metaFile[0]);

        newFiles = {
          ...obj,
          name,
          id: fileGroupId,
          date: new Date().getTime(),
          firstRow: obj.metaFile[0].join(', '),
          org: this.state.newFile.org,
        };

        this.setState({ filesError: null });
        this.props.updateCollection(
          {
            fileGroups: {
              ...this.props.collection.fileGroups,
              [fileGroupId]: newFiles,
            },
          },
          this.props.saveCollection
        );
      }
    })
    .catch(console.log);
  }

  addFolderGroup() {
    ipcPromise.send('open-dialog')
    .then((obj) => {

      let newFiles;

      const fileGroupId = shortid.generate();

      if (obj.error) {
        this.setState({ filesError: obj.error });
      } else {
        const name = `Group ${Object.keys(this.props.collection.fileGroups).length + 1} (${obj.extension.toUpperCase()})`;

        this.props.setRowArray([this.props.dataType]);

        newFiles = {
          name,
          id: fileGroupId,
          extension: obj.extension,
          files: [...obj.paths],
          date: new Date().getTime(),
          firstRow: this.props.dataType
        };

        this.setState({ showFiles: { [newFiles.date]: false } });

        this.setState({ filesError: null });

        this.props.updateCollection(
          {
            fileGroups: {
              ...this.props.collection.fileGroups,
              [fileGroupId]: newFiles,
            },
          },
          this.props.saveCollection
        );
      }
    })
    .catch(console.log);
  }

 filterGetObj(arr, searchKey) {
    let searchkey = searchKey.replace('file', ''); //other object values contain the string 'file', let's remove.
    return arr.filter(function(obj) {
      return Object.keys(obj).some(function(key) {
        let objkey = obj[key];
        if(typeof objkey === 'string'){
          let fuzzy = bitap(objkey.toLowerCase(), searchkey.toLowerCase(), 1);
          if(fuzzy.length){
            return obj[key];
          }
        }
      })
    });
  }

  filterGetIndex(arr, searchKey) {
     let searchkey = searchKey.replace('file', ''); //other object values contain the string 'file', let's remove.
     return arr.findIndex(function(obj) {
       return Object.keys(obj).some(function(key) {
         let objkey = obj[key];
         if(typeof objkey === 'string'){
           let fuzzy = bitap(objkey.toLowerCase(), searchkey.toLowerCase(), 1);
           if(fuzzy.length){
             return obj[key];
           }
         }
       })
     });
   }

   async autoMap(group) {
     let inputMap = this.props.activeConsortium.pipelineSteps[0].inputMap;
     let resolveAutoMapPromises = Object.entries(inputMap).map((item, i) => {
     let type = item[0];
     let obj = item[1].ownerMappings;
     const steps = this.makePoints(group.firstRow).map(async (string, index) => {
     string = string.replace('file', '');
        if( obj && Object.keys(this.filterGetObj(obj,string)).length > 0 ){
         await this.setStepIO(
           index,
           group.id,
           0,
           type,
           this.filterGetIndex(obj,string),
           string
         );
        }
        if(obj && obj[0] && obj[0].type){
          let fuzzy = bitap(string.toLowerCase(), obj[0].type.toLowerCase(), 1);
          if(fuzzy.length){
            await this.setStepIO(
              index,
              group.id,
              0,
              type,
              0,
              string
            );
          }
        }
       });
       return Promise.all(steps);
     });
     await Promise.all(resolveAutoMapPromises);
     this.setState({ finishedAutoMapping: true });
   }


  removeFileGroup(groupId) {
    return () => {
      const groups = { ...this.props.collection.fileGroups };
      delete groups[groupId];

      // Props delete assocCons featuring groupId
      this.props.unmapAssociatedConsortia(this.props.collection.associatedConsortia)
      .then(() => {
        this.props.updateCollection(
          {
            fileGroups: { ...groups },
            associatedConsortia: [],
          },
          this.props.saveCollection
        );
      });
    };
  }

  setStepIO(i, groupId, stepIndex, objKey, index, string) {
    const { collection, rowArray, updateConsortiumClientProps } = this.props;
    let array = rowArray;
    let timeout = ((i + 1) * 250);
    let varObject = [{
      'collectionId': collection.id,
      'groupId': groupId,
      'column':  string
    }];
    return new Promise((resolve) => {
      setTimeout(() => {
        updateConsortiumClientProps(stepIndex, objKey, index, varObject);
        array.splice( array.indexOf(string), 1 );
        this.props.setRowArray(array);
        resolve();
      }, timeout);
    })
  }

  updateNewFileOrg(ev) {
    this.setState({ newFile: { ...this.state.newFile, org: ev.target.value } });
  }

  updateMapsStep(){
    this.props.updateMapsStep(true);
  }

  makePoints = ((str) => {
    str = str.split(", ");
    return str.sort();
  });

  render() {
    const {
      activeConsortium,
      collection,
      isMapped,
      saveCollection,
      rowArray,
      rowArrayLength,
      classes,
    } = this.props;

    const {
      contChildren,
      filesError,
      finishedAutoMapping,
    } = this.state;

    let dataType = 'meta';
    if(this.props.activeConsortium.pipelineSteps[0]
      && this.props.activeConsortium.pipelineSteps[0].dataMeta){
      dataType = this.props.activeConsortium.pipelineSteps[0].dataMeta.type;
    }

    return (
      <div>
        <form onSubmit={saveCollection}>
          {
            !isMapped
            && dataType === 'meta'
            && (
              <div>
                <Button
                  variant="contained"
                  color="primary"
                  className={classes.addFileGroupButton}
                  onClick={this.addFileGroup}
                >
                  Add Files Group
                </Button>
                <Divider />
              </div>
            )
          }
          {
            !isMapped
            && dataType === 'directory'
            && (
              <div>
                <Button
                  variant="contained"
                  color="primary"
                  className={classes.addFileGroupButton}
                  onClick={this.addFolderGroup}
                >
                  Add Files from Folder
                </Button>
                <Divider />
              </div>
            )
          }
          {
            filesError
            && (
              <Paper className={classes.fileErrorPaper}>
                <Typography variant="h6" className={classes.fileErrorMessage}>File Error</Typography>
                <Typography className={classes.fileErrorMessage} variant="body1">
                  {filesError}
                </Typography>
              </Paper>
            )
          }

          {
            collection.fileGroups
            && Object.values(collection.fileGroups).map(group => (
              <Paper
                key={`${group.date}-${group.extension}-${group.id}`}
                className={classes.rootPaper}
              >
                <div>
                  {
                    !isMapped
                    && (
                      <Button
                        variant="contained"
                        color="secondary"
                        className={classes.removeFileGroupButton}
                        onClick={this.removeFileGroup(group.id)}
                      >
                        <DeleteIcon />
                        Remove File Group
                      </Button>
                    )
                  }
                  <Typography>
                    <span className="bold">Name:</span> {group.name}
                  </Typography>
                  <Typography>
                    <span className="bold">Date:</span> {new Date(group.date).toUTCString()}
                  </Typography>
                  <Typography>
                    <span className="bold">Extension:</span> {group.extension}
                  </Typography>
                  {group.org === 'metafile'
                    && rowArray.length > 0
                    && (
                      <div>
                        <Typography>
                          <span className="bold">Meta File Path:</span> {group.metaFilePath}
                        </Typography>
                        <Typography>
                          <span className="bold">First Row:</span> {group.firstRow}
                        </Typography>
                      </div>
                    )}
                    {group.org !== 'metafile'
                      && (
                        <div>
                          <Typography>
                            <span className="bold">File(s):</span>
                          </Typography>
                          <div className={classes.fileList}>
                            {group.files.map((file, i) => {
                              return(
                                <div className={classes.fileListItem}>
                                  ({i+1}){file}
                                </div>)
                            })}
                          </div>
                        </div>
                      )
                    }
                    <div className="card-deck" ref="Container">
                      {group &&
                        rowArray && rowArray.map((point, index) => (
                          <div
                            className={`card-draggable card-${point.toLowerCase()}`}
                            data-filegroup={group.id}
                            data-string={point}
                            key={index}
                          >
                            <FileCopyIcon /> {point}
                          </div>
                        ))
                      }
                    </div>
                  <Divider />
                  <div className={classes.actionsContainer}>
                    {
                      !isMapped && !finishedAutoMapping && contChildren !== 0
                      && (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => this.autoMap(group)}
                        >
                          Auto Map
                        </Button>
                      )
                    }
                    {
                      !isMapped && finishedAutoMapping
                      && (
                        <Button
                          variant="contained"
                          color="primary"
                          onClick={() => this.props.saveAndCheckConsortiaMapping()}
                        >
                          Save
                        </Button>
                      )
                    }
                    {
                      isMapped
                      && (
                        <div>
                          <div className="alert alert-success" role="alert">
                            Mapping Complete!
                          </div>
                          <br />
                          <Button
                            variant="contained"
                            color="primary"
                            to="/dashboard/consortia"
                            component={Link}
                          >
                            Back to Consortia
                          </Button>
                        </div>
                      )
                    }
                  </div>
                </div>
              </Paper>
            ))
          }
        </form>
      </div>
    );
  }
}

MapsCollection.propTypes = {
  collection: PropTypes.object,
  saveCollection: PropTypes.func.isRequired,
  saveAndCheckConsortiaMapping: PropTypes.func.isRequired,
  updateConsortiumClientProps: PropTypes.func.isRequired,
  unmapAssociatedConsortia: PropTypes.func.isRequired,
  classes: PropTypes.object.isRequired,
};

MapsCollection.defaultProps = {
  collection: null,
};

const connectedComponent = connect(null, { unmapAssociatedConsortia })(MapsCollection);

export default withStyles(styles)(connectedComponent);
