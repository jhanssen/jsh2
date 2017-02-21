/*global module*/

const commands = {
    _commands: {},

    init: function init() {
    },

    add: function add(name, cmd, opts) {
        commands._commands[name] = { cmd: cmd, opts: opts };
    },

    remove: function remove(name) {
        delete commands._commands[name];
    },

    find: function find(name) {
        if (name in commands._commands)
            return commands._commands[name];
        return null;
    },

    isGenerator: function isGenerator(fun) {
        return /^function\s*\*/.test(fun.toString());
    }
};

module.exports = commands;
