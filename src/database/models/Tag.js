const { DataTypes } = require('sequelize');
const sequelize = require('../index');

const Tag = sequelize.define('Tag', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  name: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  color: {
    type: DataTypes.STRING,
    defaultValue: '#6c8cff'
  }
}, {
  tableName: 'tags',
  timestamps: false
});

module.exports = Tag;
