/*global require*/

"use strict";

const JSH = require("./lib/jsh/index");
const jsh = new JSH();
//console.log(jsh.commands);

{

    const console = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();
    console.run(jsh);
}
