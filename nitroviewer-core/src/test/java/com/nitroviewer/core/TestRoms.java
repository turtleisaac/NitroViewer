/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.Assumptions;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * Locates the retail ROM the facade tests decode against. Retail ROMs are copyrighted and are not
 * committed, so tests that need one are <em>skipped</em> (not failed) when it is absent.
 * <p>
 * Run with {@code -Drom.dir=/path/to/roms} (defaults to the current directory), optionally overriding
 * the file with {@code -Drom.name=MyRom.nds} (defaults to HeartGold.nds).
 */
final class TestRoms
{
    private TestRoms() {}

    static byte[] require(String defaultName)
    {
        Path path = Paths.get(System.getProperty("rom.dir", "."),
                System.getProperty("rom.name", defaultName));
        Assumptions.assumeTrue(Files.exists(path),
                () -> "Skipping: test ROM not found at " + path.toAbsolutePath()
                        + " -- set -Drom.dir=<dir> (and optionally -Drom.name=<file>) to run this suite.");
        try
        {
            return Files.readAllBytes(path);
        }
        catch (IOException e)
        {
            throw new RuntimeException("could not read ROM at " + path, e);
        }
    }

    /**
     * Like {@link #require}, but for a specific ROM by exact filename, ignoring {@code -Drom.name}.
     * For tests whose fixture data (a particular BMG/NFTR/NMCR file, say) only exists in one specific
     * game, so they can't just decode whatever ROM {@code -Drom.name} happens to select.
     */
    static byte[] requireNamed(String exactName)
    {
        Path path = Paths.get(System.getProperty("rom.dir", "."), exactName);
        Assumptions.assumeTrue(Files.exists(path),
                () -> "Skipping: test ROM not found at " + path.toAbsolutePath()
                        + " -- set -Drom.dir=<dir> to a directory containing " + exactName + " to run this suite.");
        try
        {
            return Files.readAllBytes(path);
        }
        catch (IOException e)
        {
            throw new RuntimeException("could not read ROM at " + path, e);
        }
    }
}
