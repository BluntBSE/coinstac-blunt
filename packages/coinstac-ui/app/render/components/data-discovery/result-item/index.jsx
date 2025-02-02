import React from 'react';
import PropTypes from 'prop-types';
import { connect } from 'react-redux';
import { Link } from 'react-router';
import cx from 'classnames';
import Box from '@material-ui/core/Box';
import Button from '@material-ui/core/Button';
import Paper from '@material-ui/core/Paper';
import Typography from '@material-ui/core/Typography';
import DeleteIcon from '@material-ui/icons/Delete';
import EditIcon from '@material-ui/icons/Edit';
import FolderOpenIcon from '@material-ui/icons/FolderOpen';
import MessageIcon from '@material-ui/icons/Message';

import useStyles from './result-item.styles';
import MemberAvatar from '../../common/member-avatar';

function ResultItem({
  auth, result, onClickDelete, className,
}) {
  const classes = useStyles();

  const {
    id, datasetDescription, participantsDescription, otherInfo, owner,
  } = result;

  return (
    <Paper elevation={3} className={cx(classes.root, className)}>
      <Box display="flex" justifyContent="space-between" alignItems="center">
        <Box>
          <Box display="flex">
            {datasetDescription && datasetDescription.Name && (
              <Typography variant="h5">{ datasetDescription.Name }</Typography>
            )}
          </Box>
          {participantsDescription && (
            <Box display="flex">
              <Typography variant="body2" className={classes.label}>Variables:</Typography>
              <Typography variant="body2">{ Object.keys(participantsDescription).join(', ') }</Typography>
            </Box>
          )}
          {otherInfo && (
            <React.Fragment>
              {otherInfo.modality && (
                <Box display="flex">
                  <Typography variant="body2" className={classes.label}>Modality:</Typography>
                  <Typography variant="body2">{ otherInfo.modality }</Typography>
                </Box>
              )}
              {otherInfo.subjectGroups && (
                <Box display="flex">
                  <Typography variant="body2" className={classes.label}>Subject groups:</Typography>
                  <Typography variant="body2">{ otherInfo.subjectGroups.join(', ') }</Typography>
                </Box>
              )}
              {otherInfo.numberOfSubjects && (
                <Box display="flex">
                  <Typography variant="body2" className={classes.label}>Number of subjects:</Typography>
                  <Typography variant="body2">{ otherInfo.numberOfSubjects }</Typography>
                </Box>
              )}
              {otherInfo.numberOfSessions && (
                <Box display="flex">
                  <Typography variant="body2" className={classes.label}>Number of sessions:</Typography>
                  <Typography variant="body2">{ otherInfo.numberOfSessions }</Typography>
                </Box>
              )}
            </React.Fragment>
          )}
        </Box>
        <Box display="flex" flexDirection="column" justifyContent="center">
          <Typography variant="body2" style={{ textAlign: 'center' }}>
            Data Owner
          </Typography>
          <MemberAvatar
            id={owner.id}
            name={owner.username}
            width={30}
            className={classes.avatar}
            showDetails
          />
          {auth.user.id === owner.id ? (
            <React.Fragment>
              <Button
                variant="contained"
                color="default"
                endIcon={<EditIcon />}
                component={Link}
                to={`/dashboard/data-discovery/${id}`}
              >
                Edit data
              </Button>
              <Button
                variant="contained"
                color="secondary"
                endIcon={<DeleteIcon />}
                onClick={onClickDelete}
                className={classes.detailsButton}
              >
                Delete
              </Button>
            </React.Fragment>
          ) : (
            <React.Fragment>
              <Button
                variant="contained"
                color="secondary"
                endIcon={<MessageIcon />}
                component={Link}
                to={encodeURI(`/dashboard/threads?new=true&title=Question about your dataset&recipientId=${owner.id}&recipientUsername=${owner.username}`)}
              >
                Message User
              </Button>
              <Button
                variant="contained"
                color="default"
                endIcon={<FolderOpenIcon />}
                component={Link}
                to={`/dashboard/data-discovery/${id}`}
                className={classes.detailsButton}
              >
                View Details
              </Button>
            </React.Fragment>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

ResultItem.defaultProps = {
  className: null,
};

ResultItem.propTypes = {
  result: PropTypes.object.isRequired,
  className: PropTypes.string,
  auth: PropTypes.object.isRequired,
  onClickDelete: PropTypes.func.isRequired,
};

const mapStateToProps = ({ auth }) => ({
  auth,
});

export default connect(mapStateToProps)(ResultItem);
