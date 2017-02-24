#!/bin/bash

if [[ ! -d ./node_modules/native-jsh ]]; then
    ln -s $PWD/native/native-jsh node_modules/native-jsh
fi

echo Building native-jsh
pushd native/native-jsh
npm run build
popd
