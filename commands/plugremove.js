const { SlashCommandBuilder } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../events.db'));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('plugremove')
        .setDescription('Removes a plug based on its index')
        .addIntegerOption(option =>
            option.setName('index')
                .setDescription('The index of the plug to remove')
                .setRequired(true)),
    async execute(interaction) {
        const index = interaction.options.getInteger('index');

        db.get(`SELECT id, event_name FROM events ORDER BY id LIMIT 1 OFFSET ?`, [index - 1], (err, row) => {
            if (err) {
                console.error('Error fetching plug:', err);
                return interaction.reply('An error occurred while fetching the plug.');
            }

            if (!row) {
                return interaction.reply('No plug found at the specified index.');
            }

            const plugId = row.id;
            const eventName = row.event_name;

            db.run(`DELETE FROM events WHERE id = ?`, [plugId], function(err) {
                if (err) {
                    console.error('Error removing plug:', err);
                    return interaction.reply('An error occurred while removing the plug.');
                }

                if (this.changes > 0) {
                    interaction.reply(`Successfully removed "${eventName}" plug.`);
                } else {
                    interaction.reply('No plug was removed. Please check the index and try again.');
                }
            });
        });
    },
};