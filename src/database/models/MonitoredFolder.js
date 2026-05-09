const { DataTypes } = require('sequelize');
const sequelize = require('../index');

const MonitoredFolder = sequelize.define('MonitoredFolder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  path: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  includeSubfolders: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  active: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  lastScanned: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'monitored_folders',
  timestamps: false
});

module.exports = MonitoredFolder;
