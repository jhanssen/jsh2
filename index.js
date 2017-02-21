/*global require*/

const console = require("./lib/console");
const commands = require("./lib/commands");
const builtins = require("./lib/builtins");

commands.init();
builtins.init();
console.run();
