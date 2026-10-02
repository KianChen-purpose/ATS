/**
 * PATS ↔ Microsoft 365 contract. Every feature talks to M365 through this interface, so the
 * whole app runs in "mock" mode for demos and switches to Microsoft Graph when credentials exist.
 */
export type IntegrationMode = "mock" | "live";

export interface SendMailInput {
  /** Mailbox to send from (user's own mailbox or a shared one like careers@). */
  from: string;
  to: string;
  subject: string;
  body: string;
  cc?: string[];
  attachments?: MailAttachment[];
}

export interface MailAttachment {
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface SendMailResult {
  messageId: string;
  threadId: string;
}

export interface BusyBlock {
  start: Date;
  end: Date;
  status: "busy" | "tentative" | "oof";
}

export interface CreateEventInput {
  organizer: string;
  attendees: { email: string; name?: string; optional?: boolean }[];
  subject: string;
  body?: string;
  start: Date;
  end: Date;
  /** Create a Teams online meeting for the event. */
  teamsMeeting?: boolean;
  location?: string;
}

export interface CreateEventResult {
  eventId: string;
  joinUrl: string | null;
  webLink: string | null;
}

export interface TeamsNotification {
  toEmail: string;
  title: string;
  text: string;
  /** Deep link back into PATS. */
  url?: string;
}

export interface M365Client {
  mode: IntegrationMode;
  mail: {
    send(input: SendMailInput): Promise<SendMailResult>;
  };
  calendar: {
    getSchedule(emails: string[], start: Date, end: Date): Promise<Record<string, BusyBlock[]>>;
    createEvent(input: CreateEventInput): Promise<CreateEventResult>;
    cancelEvent(organizer: string, eventId: string, comment?: string): Promise<void>;
  };
  teams: {
    notify(n: TeamsNotification): Promise<void>;
  };
}
