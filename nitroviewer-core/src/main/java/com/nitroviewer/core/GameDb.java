/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.io.InputStream;
import java.util.Iterator;

/**
 * The shipped <code>gamedb.json</code>. One file, read by the web app and by this jar.
 */
final class GameDb
{
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static JsonNode db;


    /** Not instantiated. */
    private GameDb()
    {
    }


    /**
     * Returns the scan direction <code>gamedb.json</code> declares for this entry
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path, already normalised
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> when the DB has no direction
     */
    static Boolean frontToBack(String gameCode, String narcPath, int entryIndex)
    {
        return frontToBack(load(), gameCode, narcPath, entryIndex);
    }


    /**
     * Scan direction in one game-db document. Does not touch the shipped cache.
     * @param json a <code>String</code> game-db document
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path, already normalised
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> when the document has no direction
     */
    static Boolean frontToBackIn(String json, String gameCode, String narcPath, int entryIndex)
    {
        JsonNode root = read(json);
        if (root == null || !root.isObject())
            throw new IllegalStateException("game db is not an object");
        return frontToBack(root, gameCode, narcPath, entryIndex);
    }


    /**
     * Returns the scan direction one parsed document declares for this entry
     * @param root a <code>JsonNode</code> game-db object
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path, already normalised
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> when the document has no direction
     */
    private static Boolean frontToBack(JsonNode root, String gameCode, String narcPath, int entryIndex)
    {
        if (gameCode == null || narcPath == null || entryIndex < 0)
            return null;

        JsonNode games = root.get("games");
        if (games == null || !games.isObject())
            return null;

        JsonNode game = game(games, gameCode);
        if (game == null)
            return null;

        JsonNode narcs = game.get("narcs");
        if (narcs == null || !narcs.isObject())
            return null;

        JsonNode narc = narcs.get(narcPath);
        if (narc == null || !narc.isObject())
            return null;

        return direction(scanDirection(narc, entryIndex));
    }


    /**
     * Picks the scan direction the same way <code>resolveRenderHints</code> does
     * @param narc a <code>JsonNode</code> for one NARC
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>front-to-back</code>, <code>back-to-front</code>, or <code>null</code>
     */
    private static String scanDirection(JsonNode narc, int entryIndex)
    {
        String direction = text(narc.get("render"), "scanDirection");

        JsonNode cipher = narc.get("cipher");
        if (cipher != null && cipher.isObject() && cipherMatches(cipher, entryIndex))
            direction = text(cipher, "scanDirection");

        JsonNode entries = narc.get("entries");
        if (entries != null && entries.isObject())
        {
            JsonNode entry = entries.get(Integer.toString(entryIndex));
            if (entry != null && entry.hasNonNull("scanDirection"))
                direction = text(entry, "scanDirection");
        }
        return direction;
    }


    /**
     * True when this entry is one of the ciphered scans
     * @param cipher a <code>JsonNode</code> cipher rule
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>true</code> when the rule applies
     */
    private static boolean cipherMatches(JsonNode cipher, int entryIndex)
    {
        if (entryIndex < 0)
            return false;
        if (!cipher.hasNonNull("indexMod"))
            return true;

        int mod = cipher.get("indexMod").asInt();
        if (mod <= 0)
            return false;

        int rem = cipher.hasNonNull("indexRem") ? cipher.get("indexRem").asInt() : 0;
        return Math.floorMod(entryIndex, mod) == rem;
    }


    /**
     * Best game entry: an exact key wins over a <code>PREFIX*</code> wildcard
     * @param games a <code>JsonNode</code> of game-code keys
     * @param gameCode a <code>String</code> game code
     * @return the game object, or <code>null</code>
     */
    private static JsonNode game(JsonNode games, String gameCode)
    {
        String code = gameCode.toUpperCase();
        if (games.has(code))
            return games.get(code);

        Iterator<String> names = games.fieldNames();
        while (names.hasNext())
        {
            String key = names.next();
            String upper = key.toUpperCase();
            if (upper.endsWith("*") && code.startsWith(upper.substring(0, upper.length() - 1)))
                return games.get(key);
        }

        return null;
    }


    /** @param scanDirection <code>front-to-back</code>, <code>back-to-front</code>, or anything else */
    private static Boolean direction(String scanDirection)
    {
        if ("front-to-back".equals(scanDirection))
            return Boolean.TRUE;
        if ("back-to-front".equals(scanDirection))
            return Boolean.FALSE;
        return null;
    }


    /**
     * Reads a string field
     * @param node a <code>JsonNode</code>, or <code>null</code>
     * @param field a <code>String</code> field name
     * @return the text, or <code>null</code> when the field is missing or not a string
     */
    private static String text(JsonNode node, String field)
    {
        if (node == null || !node.hasNonNull(field) || !node.get(field).isTextual())
            return null;
        return node.get(field).asText();
    }


    /** Loads <code>/gamedb.json</code> once. */
    private static JsonNode load()
    {
        if (db != null)
            return db;

        synchronized (GameDb.class)
        {
            if (db != null)
                return db;

            InputStream in = GameDb.class.getResourceAsStream("/gamedb.json");
            if (in == null)
                throw new IllegalStateException("gamedb.json is not in the jar");
            try
            {
                db = MAPPER.readTree(in);
                if (db == null || !db.isObject())
                    throw new IllegalStateException("gamedb.json is not an object");
                return db;
            }
            catch (IOException e)
            {
                throw new IllegalStateException("could not read gamedb.json", e);
            }
            finally
            {
                try
                {
                    in.close();
                }
                catch (IOException ignored)
                {}
            }
        }
    }


    /**
     * Parses one JSON document
     * @param json a <code>String</code> of JSON
     * @return the root <code>JsonNode</code>
     */
    private static JsonNode read(String json)
    {
        try
        {
            return MAPPER.readTree(json);
        }
        catch (IOException e)
        {
            throw new IllegalStateException("could not read gamedb.json", e);
        }
    }
}
