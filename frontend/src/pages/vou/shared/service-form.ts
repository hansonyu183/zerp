import type {
  VoucherDocumentView,
  VoucherDraftForm,
} from '@/components/voucher'
import { localDate } from '@/utils/date'

type ServiceDetails = Pick<
  VoucherDraftForm,
  'serviceContract' | 'serviceAcceptance'
>

export function emptyServiceDetails(): ServiceDetails {
  return {
    serviceContract: {
      capabilities: [],
      applicableFrom: '',
      applicableTo: '',
      terms: '',
    },
    serviceAcceptance: {
      contractDocumentId: '',
      serviceDate: localDate(),
      acceptanceDate: localDate(),
      settlementDirection: '',
      fulfillmentFact: '',
      acceptanceFact: '',
    },
  }
}

export function serviceDetailsFromDocument(
  data: VoucherDocumentView['data'],
): ServiceDetails {
  return {
    serviceContract: {
      capabilities: data.serviceContract?.capabilities ?? [],
      applicableFrom: data.serviceContract?.applicableFrom ?? '',
      applicableTo: data.serviceContract?.applicableTo ?? '',
      terms: data.serviceContract?.terms ?? '',
    },
    serviceAcceptance: {
      contractDocumentId: data.serviceAcceptance?.contractDocumentId ?? '',
      serviceDate: data.serviceAcceptance?.serviceDate ?? localDate(),
      acceptanceDate: data.serviceAcceptance?.acceptanceDate ?? localDate(),
      settlementDirection: data.serviceAcceptance?.settlementDirection ?? '',
      fulfillmentFact: data.serviceAcceptance?.fulfillmentFact ?? '',
      acceptanceFact: data.serviceAcceptance?.acceptanceFact ?? '',
    },
  }
}
