/*
 * NitroViewer - released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import org.junit.jupiter.api.Test;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;

class ParticleFramesTest
{
    @Test
    void positiveRateCarriesTheRendererSchedule() throws Exception
    {
        String json = ParticleFrames.render(solidSpa(), 32, 32, 30, 30);

        int sum = delaySum(json);
        assertThat(sum).isEqualTo(100);
        assertThat(json).contains("\"emitterCount\":1");
        assertThat(json).contains("data:image/png;base64,");
    }

    @Test
    void missingRateOmitsDelays() throws Exception
    {
        String json = ParticleFrames.render(solidSpa(), 32, 32, 4, 0);

        assertThat(json).doesNotContain("delaysCs");
        assertThat(json).contains("\"frames\":[");
    }

    private static int delaySum(String json)
    {
        String marker = "\"delaysCs\":[";
        int start = json.indexOf(marker) + marker.length();
        int end = json.indexOf(']', start);
        String body = json.substring(start, end);
        int sum = 0;
        for (String part : body.split(","))
        {
            sum += Integer.parseInt(part.trim());
        }
        return sum;
    }

    /** One solid 16×16 sprite at scale 1, enough for the renderer to emit frames. */
    private static byte[] solidSpa()
    {
        ByteBuffer buf = ByteBuffer.allocate(0x78 + 304).order(ByteOrder.LITTLE_ENDIAN);
        buf.put(" APS".getBytes(StandardCharsets.ISO_8859_1));
        buf.put("12_1".getBytes(StandardCharsets.ISO_8859_1));
        buf.putShort((short) 1);
        buf.putShort((short) 1);
        buf.position(0x18);
        buf.putInt(0x78);

        buf.position(0x20);
        byte[] emitter = new byte[0x58];
        ByteBuffer body = ByteBuffer.wrap(emitter).order(ByteOrder.LITTLE_ENDIAN);
        body.putInt(16, 0x1000);
        body.putInt(44, 0x1000);
        body.putShort(48, (short) 0x1000);
        body.putShort(60, (short) 4);
        body.putShort(62, (short) 8);
        emitter[0x44] = 1;
        emitter[0x45] = 31;
        buf.put(emitter);

        buf.put(" TPS".getBytes(StandardCharsets.ISO_8859_1));
        buf.putInt(6 | (1 << 4) | (1 << 8));
        buf.putInt(256);
        buf.putInt(0x120);
        buf.putInt(16);
        buf.putInt(304);
        buf.putInt(0);
        buf.putInt(304);
        for (int texel = 0; texel < 256; texel++)
        {
            buf.put((byte) ((31 << 3) | 1));
        }
        buf.putShort((short) 0);
        buf.putShort((short) 0x7FFF);
        for (int color = 0; color < 6; color++)
        {
            buf.putShort((short) 0);
        }
        return buf.array();
    }
}
