// services/slotGenerationService.ts

import { parseTimeframe, checkExternalAvailability, findAvailableSlots, notifyNoAvailableSlots } from "../../utils/approve-callback.utils";
import { sendTelegramSlotSelection } from "../../utils/meetingUtils/telegramUtils";
import prisma from "../../utils/prisma";
import { sendTelegramMessage } from "../telegramService";


export async function generateSlotsAndSendTelegramMessage(
  meetingRequest: any,
  targetEmail: string,
  requesterUser: any,
  tokenData: any,
  accessRequest: any
) {
  console.log(`📅 [SLOT GENERATION] Starting for meeting: ${meetingRequest.title || meetingRequest.purpose}`);
  
  try {
    const meetingData = {
      id: meetingRequest.id,
      title: meetingRequest.title || accessRequest.purpose,
      description: meetingRequest.description || accessRequest.purpose,
      duration: meetingRequest.duration || accessRequest.preferredDuration || 30,
      preferredTimeframe: meetingRequest.preferredTimeframe || accessRequest.preferredTimeframe || 'this week',
      targetEmail: targetEmail,
      purpose: meetingRequest.purpose || accessRequest.purpose,
      location: meetingRequest.location || accessRequest.location,
      meetingLink: null,
    };

    console.log(`✅ [SLOT GENERATION] Meeting data created:`, meetingData);

    // Step 1: Parse timeframe and get date range
    console.log(`📅 [SLOT GENERATION] Parsing timeframe: ${meetingData.preferredTimeframe}`);
    const { startDate, endDate } = parseTimeframe(meetingData.preferredTimeframe);
    
    console.log(`✅ [SLOT GENERATION] Date range determined:`, {
      startDate,
      endDate,
      timeframe: meetingData.preferredTimeframe
    });

    // Step 2: Check external user's availability
    console.log(`🔍 [SLOT GENERATION] Checking external availability for ${targetEmail}`);
    const availabilityResult = await checkExternalAvailability(
      requesterUser.id,
      targetEmail,
      startDate,
      endDate
    );

    console.log(`📊 [SLOT GENERATION] Availability result:`, {
      success: availabilityResult.success,
      busySlotsCount: availabilityResult.success ? availabilityResult.busySlots?.length : 0,
      error: availabilityResult.success ? null : availabilityResult.error
    });

    if (!availabilityResult.success) {
      console.log(`❌ [SLOT GENERATION] Failed to get availability: ${availabilityResult.error}`);
      throw new Error(`Failed to get availability: ${availabilityResult.error}`);
    }

    // Step 3: Find suitable time slots
    console.log(`🎯 [SLOT GENERATION] Finding available slots`);
    const availableSlots = findAvailableSlots(
      availabilityResult.busySlots,
      startDate,
      endDate,
      meetingData.duration
    );

    console.log(`📅 [SLOT GENERATION] Available slots found:`, {
      count: availableSlots.length,
      slots: availableSlots.map(slot => ({
        start: slot.start,
        end: slot.end
      }))
    });

    if (availableSlots.length === 0) {
      console.log(`❌ [SLOT GENERATION] No slots available - notifying user`);
      await notifyNoAvailableSlots(meetingData, requesterUser);
      return;
    }

    const slotOffer = await prisma.slotOffer.create({
  data: {
    accessRequest: { connect: { id: meetingRequest.accessRequestId } }, 
    meetingRequest: { connect: { id: meetingRequest.id } },             
    telegramChatId: accessRequest.requesterUser.telegramChatId,         
    offeredSlots: availableSlots as any,                                
    status: 'active',                                                   
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)        
  }
});


    console.log(`✅ [SLOT GENERATION] Created slot offer: ${slotOffer.id} with ${availableSlots.length} slots`);

    // Step 5: Send Telegram message with slot selection buttons to the requester
    if (requesterUser.telegramChatId) {
      await sendTelegramSlotSelection(
        requesterUser.telegramChatId,
        meetingData,
        targetEmail,
        availableSlots,
        slotOffer.id
      );
      console.log(`✅ [SLOT GENERATION] Telegram slot selection message sent to requester`);
    } else {
      console.log(`⚠️ [SLOT GENERATION] Requester has no Telegram chat ID, cannot send notification`);
    }

  } catch (error: any) {
    console.error(`❌ [SLOT GENERATION ERROR] Error generating slots for meeting ${meetingRequest.id}:`, error.message);
    
    // Send error message to requester
    if (requesterUser.telegramChatId) {

      await sendTelegramMessage(
        requesterUser.telegramChatId,
        `❌ **Slot Generation Failed**\n\n` +
        `📝 **Meeting:** ${meetingRequest.title || meetingRequest.purpose}\n` +
        `👤 **With:** ${targetEmail}\n\n` +
        `Error: ${error.message}`
      );
    }
  }
}