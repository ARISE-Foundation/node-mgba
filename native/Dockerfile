FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc-mingw-w64-x86-64 \
    g++-mingw-w64-x86-64 \
    binutils-mingw-w64-x86-64 \
    cmake \
    ninja-build \
    make \
    mawk \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
