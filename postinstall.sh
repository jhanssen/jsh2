#!/bin/bash

if [[ ! -d ./node_modules/native-jsh ]]; then
    ln -s $PWD/native/native-jsh node_modules/native-jsh
fi

if [[ ! -d ./node_modules/native-ipc ]]; then
    ln -s $PWD/native/native-ipc node_modules/native-ipc
fi

echo Building native-jsh
pushd native/native-jsh
npm run build
popd

echo Building native-ipc
pushd native/native-ipc
npm run build
popd
