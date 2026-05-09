const { DataTypes } = require('sequelize');
const sequelize = require('../index');

const IndexedFile = sequelize.define('IndexedFile', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  path: {
    type: DataTypes.STRING,
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  folderId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'indexed_files',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['path'] },
    { fields: ['folderId'] }
  ]
});

module.exports = IndexedFile;
