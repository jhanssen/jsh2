/*global require,module*/
// class Command {
//     constructor(name) {
//         this._name = name;
//     }

//     get name() { return this._name; }
// }

const commands = {
    _commands: {},

    init: function init() {
    },

    add: function add(name, cmd) {
        commands._commands[name] = cmd;
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

    //Command: Command
};

module.exports = commands;
