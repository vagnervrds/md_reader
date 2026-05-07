const { DataTypes } = require('sequelize');
const sequelize = require('../index');

const RecentFile = sequelize.define('RecentFile', {
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
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  last_opened: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'recent_files',
  timestamps: false
});

module.exports = RecentFile;
