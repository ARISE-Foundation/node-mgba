CC ?= gcc
CFLAGS ?= -O3 -Wall -Wextra -fPIC -DENABLE_VFS=1 -DENABLE_DIRECTORIES=1
MGBA_DIST ?= ../vendor/mgba-dist
INCLUDES = -I$(MGBA_DIST)/include
LDFLAGS = -L$(MGBA_DIST)/lib -lmgba -Wl,-rpath,'$$ORIGIN/../vendor/mgba-dist/lib'

TARGET = libmgba_shim.so

all: $(TARGET)

$(TARGET): mgba_shim.c mgba_shim.h
	$(CC) $(CFLAGS) $(INCLUDES) -shared -o $@ mgba_shim.c $(LDFLAGS)

clean:
	rm -f $(TARGET)

.PHONY: all clean

