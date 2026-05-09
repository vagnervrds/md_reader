const { DataTypes } = require('sequelize');
const sequelize = require('../index');

const FileTag = sequelize.define('FileTag', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  filePath: {
    type: DataTypes.STRING,
    allowNull: false
  },
  tagId: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'file_tags',
  timestamps: false,
  indexes: [
    { unique: true, fields: ['filePath', 'tagId'] },
    { fields: ['tagId'] }
  ]
});

module.exports = FileTag;
