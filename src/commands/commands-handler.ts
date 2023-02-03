import { App } from '../app'
import { createSettingsModal } from '../events/settings/settings-modal-builder'
import { postToTeam, revealTeam, updateResponseCount } from '../messages/message-poster'
import logger from '../logger'
import { createTeam, getActiveAsk, getTeam, prisma } from '../db'
import { scoreQuestions } from '../metrics/metrics'

export function configureCommandsHandler(app: App): void {
    // Handles the /helsesjekk command, it opens the settings modal
    app.command(/(.*)/, async ({ command, ack, client }) => {
        logger.info(`User used /helsesjekk command`)

        const isBotInChannel = await isBotAddedToChannel(command.channel_id, client)
        if (isBotInChannel !== true) {
            logger.warn(
                `Someone used /helsesjekk in a DM or a channel where it hasn't been added. Type: ${isBotInChannel} Channel ID: ${command.channel_id}`,
            )
            await ack()
            return
        }

        await ack()
        const team = (await getTeam(command.channel_id)) ?? (await createTeam(command.channel_id, '[Ditt Team]'))
        await client.views.open({
            trigger_id: command.trigger_id,
            view: createSettingsModal(team),
        })
    })

    // TODO inn i settings slash command?
    app.event('app_mention', async ({ event, say }) => {
        logger.info(`User mentioned the bot in ${process.env.NODE_ENV}`)

        try {
            if (process.env.NODE_ENV !== 'production') {
                // dev tool for forcing the bot to post questionnaire
                if (event.text.endsWith('post')) {
                    const team = await getTeam(event.channel)
                    if (team != null) {
                        await postToTeam(team, app.client)
                    }
                }

                // dev tool for forcing the bot to reveal the answers
                if (event.text.endsWith('lock')) {
                    const team = await getTeam(event.channel)
                    if (team != null) {
                        await revealTeam(team, app.client)
                    }
                }

                // dev tool for forcing the bot to reveal the answers
                if (event.text.endsWith('unlock')) {
                    const team = await getTeam(event.channel)
                    if (team != null) {
                        const toUpdate = await prisma.asked.findFirst({
                            where: { teamId: team.id },
                            orderBy: { timestamp: 'desc' },
                        })
                        if (!toUpdate) return

                        await prisma.asked.update({
                            data: { revealed: false },
                            where: { id: toUpdate.id },
                        })
                        logger.info(`Unlocked ${team.name} (${team.id})`)
                        await updateResponseCount(team, app.client)
                    }
                }

                if (event.text.endsWith('debug')) {
                    const activeAsk = await getActiveAsk(event.channel)

                    if (activeAsk == null) {
                        return
                    }

                    scoreQuestions(activeAsk)
                }
            }
        } catch (e) {
            logger.error(e)
            await say('Oi! Noe gikk galt i botten. :( Dersom det skjer igjen, ta kontakt i #helsesjekk-bot.')
        }
    })
}

async function isBotAddedToChannel(
    channel: string,
    client: App['client'],
): Promise<true | 'not_in_private' | 'not_in_public' | 'unknown'> {
    try {
        const channelInfo = await client.conversations.info({
            channel: channel,
        })

        if (channelInfo.ok && channelInfo.channel && !channelInfo.channel.is_member) {
            return 'not_in_public'
        }

        if (!channelInfo.ok) {
            logger.info(
                `Unable to get channel info, integration not in channel, or is a DM?: ${
                    channelInfo.error ?? 'No error'
                }`,
            )
            return 'not_in_private'
        }

        return true
    } catch (e) {
        logger.error(new Error("Couldn't get channel info", { cause: e }))
        return 'unknown'
    }
}
