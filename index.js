/*global require*/

"use strict";

const nativeJsh = require("native-jsh");
const native = nativeJsh.init();

const nodeCleanup = require('node-cleanup');
nodeCleanup(() => {
    nativeJsh.deinit();
});

const job = new nativeJsh.Job();
job.add("foobar");

const JSH = require("./lib/jsh/index");
const jsh = new JSH();
//console.log(jsh.commands);

{
    const console = require("./lib/console");
    const commands = require("./lib/commands");
    const builtins = require("./lib/builtins");

    commands.init();
    builtins.init();
    if (native.interactive) {
        console.run(jsh);
    } else {
        // we'll want to read arguments at this point and execute commands
    }
}
