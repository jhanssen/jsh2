#!/bin/bash
if [[ `uname -s` == "Linux" ]]; then
  export CC=/usr/bin/gcc
  export CXX=/usr/bin/g++
fi
bear gmake -B -C build
