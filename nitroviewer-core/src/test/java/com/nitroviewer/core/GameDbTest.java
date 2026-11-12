/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Family plus language merge. No ROM data.
 */
@DisplayName("game DB folders")
class GameDbTest
{
    private static final String FAMILY = "{\"version\":1,\"_source\":\"note\",\"title\":\"Wild\",\"narcs\":{"
            + "\"/conflict.narc\":{\"render\":{\"scanDirection\":\"front-to-back\"},"
            + "\"cipher\":{\"scanDirection\":\"back-to-front\",\"indexMod\":5,\"indexRem\":4},"
            + "\"entries\":{\"4\":{\"scanDirection\":\"front-to-back\"}}},"
            + "\"/other.narc\":{\"render\":{\"scanDirection\":\"front-to-back\"}}"
            + "}}";

    private static final String KEEP = "{\"narcs\":{"
            + "\"/conflict.narc\":{\"render\":{\"tileWidth\":32}},"
            + "\"/added.narc\":{\"render\":{\"scanDirection\":\"back-to-front\"}}"
            + "}}";

    private static final String REPLACE = "{\"narcs\":{\"/conflict.narc\":{\"render\":{\"scanDirection\":\"back-to-front\"}}}}";


    @Test
    @DisplayName("a language override deep-merges one NARC and leaves the rest")
    void languageOverrideDeepMerges()
    {
        assertThat(GameDb.frontToBackFiles(FAMILY, KEEP, "CPUE", "/conflict.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBackFiles(FAMILY, KEEP, "cpue", "/conflict.narc", 9))
                .isFalse();
        assertThat(GameDb.frontToBackFiles(FAMILY, KEEP, "CPUE", "/conflict.narc", 4))
                .isTrue();
        assertThat(GameDb.frontToBackFiles(FAMILY, KEEP, "CPUE", "/other.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBackFiles(FAMILY, KEEP, "CPUE", "/added.narc", 0))
                .isFalse();
    }


    @Test
    @DisplayName("the override wins a field, and a code longer than four characters stays on the family")
    void exactLetterBeatsFamily()
    {
        assertThat(GameDb.frontToBackFiles(FAMILY, REPLACE, "CPUE", "/conflict.narc", 0))
                .isFalse();
        assertThat(GameDb.frontToBackFiles(FAMILY, REPLACE, "CPUE", "/conflict.narc", 4))
                .isTrue();
        assertThat(GameDb.frontToBackFiles(FAMILY, REPLACE, "CPUEE", "/conflict.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBackFiles(FAMILY, REPLACE, "CPU", "/other.narc", 1))
                .isTrue();
    }


    @Test
    @DisplayName("missing pieces and a bad document")
    void missingAndBroken()
    {
        assertThat(GameDb.frontToBackFiles(null, null, "CPUE", "/conflict.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBackFiles(null, KEEP, "CPUE", "/added.narc", 0))
                .isFalse();
        assertThat(GameDb.frontToBackFiles(FAMILY, null, "CPUE", "/other.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBackFiles("[]", null, "CPUE", "/other.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBackFiles(FAMILY, REPLACE, "AB", "/other.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBackFiles(null, null, null, "/other.narc", 0))
                .isNull();
        assertThatThrownBy(() -> GameDb.frontToBackFiles("{", null, "CPUE", "/other.narc", 0))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> GameDb.frontToBack("BADE", "/nope.narc", 0))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("not an object");
        assertThatThrownBy(() -> GameDb.frontToBack("MALE", "/nope.narc", 0))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("could not read");

        String missed = "{\"games\":{\"ZZZ*\":{\"title\":\"W\"},\"ZZZE\":{\"title\":\"E\"}}}";
        assertThat(GameDb.frontToBackIn(missed, "ABCD", "/a.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBackIn("{\"games\":{}}", "ABCD", "/a.narc", 0))
                .isNull();
    }


    @Test
    @DisplayName("classpath families, and a test-only language folder")
    void classpathFolders()
    {
        assertThat(GameDb.frontToBack("CPUE", "/poketool/pokegra/pl_pokegra.narc", 1))
                .isTrue();
        assertThat(GameDb.frontToBack("CPUE", "/poketool/pokegra/pl_pokegra.narc", 1))
                .isTrue();
        assertThat(GameDb.frontToBack("CPU", "/poketool/pokegra/pl_pokegra.narc", 1))
                .isTrue();
        assertThat(GameDb.frontToBack("CPUEE", "/poketool/pokegra/pl_pokegra.narc", 1))
                .isTrue();
        assertThat(GameDb.frontToBack("ADAE", "/poketool/pokegra/pokegra.narc", 3))
                .isFalse();
        assertThat(GameDb.frontToBack("QQQQ", "/nope.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBack("QQQQ", "/nope.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBack("AB", "/nope.narc", 0))
                .isNull();

        assertThat(GameDb.frontToBack("ZZZE", "/conflict.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBack("ZZZJ", "/conflict.narc", 0))
                .isTrue();
        assertThat(GameDb.frontToBack("ZZZE", "/added.narc", 0))
                .isFalse();
        assertThat(GameDb.frontToBack("ZZZJ", "/added.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBack("ZZZEE", "/added.narc", 0))
                .isNull();
        assertThat(GameDb.frontToBack("ZZZE", "/conflict.narc", 4))
                .isTrue();
        assertThat(GameDb.frontToBack("zzze", "/conflict.narc", 9))
                .isFalse();
        assertThat(GameDb.frontToBack("ZZZE", "/other.narc", 0))
                .isTrue();
    }
}
