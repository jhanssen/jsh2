/*global require*/

const console = require("./console");
const commands = require("./commands");
const builtins = require("./builtins");

commands.init();
builtins.init();
console.run();
